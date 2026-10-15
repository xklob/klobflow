"""Reproducible, recording-held-out local tip-classifier experiment.

python -m motion.training.train --manifest review/private-manifest.json --output review/tip-training
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch
from torchvision.transforms import ColorJitter

from .data import assert_disjoint, load_sources
from .model import TipClassifier, TipFeatures, candidate_crops, tensor_crops


def source_fingerprint(manifest, examples, frames, variants, seed):
    """Invalidate cached features when data, replay boundaries or code changes."""
    digest=hashlib.sha256()
    digest.update(json.dumps({'variants':variants,'seed':seed},sort_keys=True).encode())
    for path in [manifest['labels'], *[manifest['replays'][key] for key in sorted(manifest['replays'])],
                 *[Path(__file__).with_name(name) for name in ('train.py','data.py','model.py')]]:
        digest.update(Path(path).read_bytes())
    for clip,index in sorted({(e.clip,e.frame) for e in examples}):
        digest.update(f'{clip}:{index}'.encode())
        digest.update(frames[clip][index].tobytes())
    return digest.hexdigest()


def extract(examples, frames, device, variants, seed):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    backbone = TipFeatures(pretrained=True).eval().to(device)
    jitter = ColorJitter(brightness=.25, contrast=.25, saturation=.5, hue=.12)
    features, rows = [], []
    with torch.inference_mode():
        for n, example in enumerate(examples):
            frame = frames[example.clip][example.frame,:,:,:3]
            crops, metadata = [], []
            for variant in range(variants):
                point, inward, length = example.point.copy(), example.inward.copy(), example.length
                if variant:
                    point += rng.normal(0, example.uncertainty/2, 2)
                    angle = rng.uniform(-.2, .2)
                    rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
                    inward = rotation @ inward
                    length *= rng.uniform(.85, 1.15)
                views = candidate_crops(frame, point, inward, length)
                if variant and rng.random() < .5:
                    views = [np.ascontiguousarray(c[:,::-1]) for c in views]
                crops.extend(views)
                metadata.append({"clip":example.clip,"frame":example.frame,"candidate":example.candidate,
                                 "label":example.label,"kind":example.kind,"variant":variant})
            # Run a bounded batch. Features/labels are saved, never RGB frames.
            values = []
            for begin in range(0,len(crops),16):
                batch = tensor_crops(crops[begin:begin+16],device)
                # Preserve the unaugmented evaluation crop exactly.
                if begin == 0:
                    batch = torch.cat((batch[:1], jitter(batch[1:]))) if len(batch)>1 else batch
                else:
                    batch = jitter(batch)
                values.append(backbone(batch).cpu())
            features.extend(torch.cat(values).numpy())
            rows.extend(metadata)
            if (n+1)%20 == 0:
                print(f"features {n+1}/{len(examples)}",flush=True)
    return np.stack(features), rows, backbone.cpu().state_dict()


def ranking_pairs(rows):
    grouped={}
    for i,row in enumerate(rows):
        if row['kind']=='boundary':
            grouped.setdefault((row['clip'],row['frame'],row['variant']),[]).append((i,row['label']))
    return [(next(i for i,label in group if label==1),next(i for i,label in group if label==0))
            for group in grouped.values() if len(group)==2 and sum(label for _,label in group)==1]


def fit_head(features, labels, regularization=.01, pairs=()):
    # A frozen pretrained backbone and regularized linear head keep the first
    # experiment small enough for the available labels and 4 GB GPU.
    x = torch.from_numpy(features).float()
    y = torch.tensor(labels,dtype=torch.float32)
    center = x.mean(0)
    scale = x.std(0).clamp_min(.05)
    x = (x-center)/scale
    head = torch.nn.Linear(x.shape[1],1)
    torch.nn.init.zeros_(head.weight)
    torch.nn.init.zeros_(head.bias)
    positives = y.sum()
    if positives <= 0 or positives >= len(y):
        raise ValueError("Both positive and negative training examples are required")
    weights = torch.where(y>0,len(y)/(2*positives),len(y)/(2*(len(y)-positives)))
    pairs=torch.as_tensor(pairs,dtype=torch.long).reshape(-1,2)
    optimizer = torch.optim.LBFGS(head.parameters(),max_iter=150,line_search_fn="strong_wolfe")
    def closure():
        optimizer.zero_grad()
        logits = head(x).flatten()
        loss = (torch.nn.functional.binary_cross_entropy_with_logits(logits,y,reduction="none")*weights).mean()
        if len(pairs):
            # Optimize the actual decision: which boundary is the real cap?
            # The smaller binary term retains the unpaired visible examples.
            margin=logits[pairs[:,0]]-logits[pairs[:,1]]
            loss=.25*loss+torch.nn.functional.softplus(-margin).mean()
        loss = loss + regularization*head.weight.square().sum()
        loss.backward()
        return loss
    optimizer.step(closure)
    return center,scale,head


def metrics(labels, scores):
    labels,scores = np.asarray(labels),np.asarray(scores)
    predicted = scores >= .5
    tp = int(((labels==1)&predicted).sum())
    tn = int(((labels==0)&~predicted).sum())
    fp = int(((labels==0)&predicted).sum())
    fn = int(((labels==1)&~predicted).sum())
    return {"count":len(labels),"truePositive":tp,"trueNegative":tn,"falsePositive":fp,"falseNegative":fn,
            "visibleRecall":tp/(tp+fn) if tp+fn else None,"boundaryRejection":tn/(tn+fp) if tn+fp else None,
            "balancedAccuracy":.5*(tp/(tp+fn)+tn/(tn+fp)) if (tp+fn)*(tn+fp) else None}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--manifest",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--variants",type=int,default=48)
    parser.add_argument("--seed",type=int,default=20261015)
    args=parser.parse_args()
    if not 1 <= args.variants <= 128:
        parser.error("variants must be 1..128")
    torch.set_num_threads(4)
    torch.manual_seed(args.seed)
    started=time.monotonic()
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    manifest,examples,skipped,frames=load_sources(args.manifest)
    fingerprint=source_fingerprint(manifest,examples,frames,args.variants,args.seed)
    cache=output/'features.pt'
    if cache.exists():
        data=torch.load(cache,weights_only=True)
        if data['fingerprint'] != fingerprint:
            raise ValueError("Feature cache does not match manifest, labels or recipe; use a new output directory")
        features=data['features'].numpy();rows=data['rows'];backbone=data['backbone']
    else:
        features,rows,backbone=extract(examples,frames,'cuda' if torch.cuda.is_available() else 'cpu',args.variants,args.seed)
        torch.save({'fingerprint':fingerprint,'features':torch.from_numpy(features),'rows':rows,'backbone':backbone},cache)
    groups=sorted({r['clip'] for r in rows})
    if len(groups)<3:
        raise ValueError("This experiment requires at least three recording groups")
    report={'recipe':{'backbone':'MobileNetV3 small ImageNet1K V1 frozen','scales':[.45],
                       'cropSize':224,'variants':args.variants,'seed':args.seed,'head':'pairwise ranking with balanced binary auxiliary loss',
                       'rankingWeight':1.,'binaryWeight':.25,
                       'regularization':.01,'split':'leave one entire recording out'},
            'sourceFingerprint':fingerprint,'skipped':skipped,'folds':{},'predictions':[]}
    for held in groups:
        train=np.array([r['clip']!=held for r in rows])
        test=np.array([r['clip']==held and r['kind']=='boundary' and r['variant']==0 for r in rows])
        assert_disjoint([r['clip'] for r,t in zip(rows,train) if t],[r['clip'] for r,t in zip(rows,test) if t])
        training=[r for r,t in zip(rows,train) if t]
        center,scale,head=fit_head(features[train],[r['label'] for r in training],pairs=ranking_pairs(training))
        with torch.inference_mode():
            logits=head((torch.from_numpy(features[test])-center)/scale).flatten()
            scores=logits.sigmoid().numpy()
        tested=[r for r,t in zip(rows,test) if t]
        fold=metrics([r['label'] for r in tested],scores)
        pairs={}
        for row,score,logit in zip(tested,scores,logits):
            record={**row,'score':float(score),'logit':float(logit),'heldOut':held}
            report['predictions'].append(record)
            pairs.setdefault(row['frame'],[]).append(record)
        mixed=[pair for pair in pairs.values() if len(pair)==2 and sum(r['label'] for r in pair)==1]
        fold['mixedBoundaryPairs']=len(mixed)
        fold['correctAnchorRanking']=sum(max(pair,key=lambda r:r['logit'])['label'] for pair in mixed)
        report['folds'][held]=fold
        model=TipClassifier();model.features.load_state_dict(backbone)
        model.center.copy_(center);model.scale.copy_(scale);model.head.load_state_dict(head.state_dict())
        torch.save({'format':'klobflow-tip-v2','state_dict':model.state_dict(),
                    'metadata':{'trainingRecordings':[g for g in groups if g!=held],'heldOutRecording':held,
                                'sourceFingerprint':fingerprint,'recipe':report['recipe']}},output/f'holdout-{held}.pt')
        print(held,json.dumps(fold),flush=True)
    center,scale,head=fit_head(features,[r['label'] for r in rows],pairs=ranking_pairs(rows))
    model=TipClassifier();model.features.load_state_dict(backbone)
    model.center.copy_(center);model.scale.copy_(scale);model.head.load_state_dict(head.state_dict())
    torch.save({'format':'klobflow-tip-v2','state_dict':model.state_dict(),
                'metadata':{'trainingRecordings':groups,'sourceFingerprint':fingerprint,'recipe':report['recipe'],
                            'note':'Local experimental model; all-recording fit has no held-out score.'}},output/'all-recordings.pt')
    report['elapsedSeconds']=time.monotonic()-started
    (output/'report.json').write_text(json.dumps(report,indent=2))
    print('report',output/'report.json',flush=True)


if __name__=='__main__':
    main()
