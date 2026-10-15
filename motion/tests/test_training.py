import json
import numpy as np
import pytest
import torch

from motion.training.data import aligned_crop, assert_disjoint, examples_from_labels, load_sources
from motion.training.model import TipClassifier
from motion.training.train import fit_head, ranking_pairs
from motion.shape import StaffShape
from motion.tests.test_shape import mask


def test_hidden_end_never_becomes_an_invented_positive_position():
    labels={'width':300,'height':200,'frames':[
        {'clip':'a','index':1,'ends':[
            {'visibility':'visible','point':[60,100],'uncertainty_px':3},
            {'visibility':'hidden','point':None,'uncertainty_px':None}]}]}
    replay={'a':{1:{'visibleExtent':[[.2,.5],[.5,.5]],'ends':[{'x':.2,'y':.5},{'x':.8,'y':.5}]}}}
    examples,_=examples_from_labels(labels,replay)
    assert [(e.candidate,e.label) for e in examples if e.kind=='boundary']==[(0,1),(1,0)]
    assert len([e for e in examples if e.kind=='annotation'])==1
    labels['frames'][0]['ends'][1]['visibility']='ambiguous'
    examples,_=examples_from_labels(labels,replay)
    assert [(e.candidate,e.label) for e in examples if e.kind=='boundary']==[(0,1)]


def test_uncertain_annotation_boundary_is_excluded_not_relabelled():
    labels={'width':300,'height':200,'frames':[
        {'clip':'a','index':1,'ends':[{'visibility':'visible','point':[60,100],'uncertainty_px':3},
                                    {'visibility':'hidden','point':None,'uncertainty_px':None}]}]}
    replay={'a':{1:{'visibleExtent':[[67.5/300,.5],[.5,.5]],'ends':[{'x':.2,'y':.5},{'x':.8,'y':.5}]}}}
    examples,skipped=examples_from_labels(labels,replay)
    assert not any(e.kind=='boundary' and e.candidate==0 for e in examples)
    assert skipped[0]['reason']=='uncertain boundary label'


def test_recording_splits_cannot_leak_adjacent_frames_or_augmentations():
    assert_disjoint(['one','one','two'],['three'])
    with pytest.raises(ValueError,match='leakage'):
        assert_disjoint(['one','two'],['two'])
    with pytest.raises(ValueError,match='required'):
        assert_disjoint([],['two'])


def test_recording_aliases_do_not_create_fake_holdouts(tmp_path):
    source={'video':str(tmp_path/'one.mp4'),'cache':str(tmp_path/'one.bgra')}
    labels=tmp_path/'labels.json'
    labels.write_text(json.dumps({'clips':{'a':source,'b':source}}))
    manifest=tmp_path/'manifest.json'
    manifest.write_text(json.dumps({'labels':str(labels),'replays':{'a':'a.json','b':'b.json'}}))
    with pytest.raises(ValueError,match='Duplicate recording'):
        load_sources(manifest)


def test_ranking_pairs_share_recording_frame_and_variant():
    rows=[{'clip':clip,'frame':1,'variant':variant,'kind':'boundary','label':label}
          for clip,variant,label in [('a',0,1),('b',0,0),('a',1,0),('a',0,0)]]
    assert ranking_pairs(rows)==[(0,3)]


def test_crop_keeps_candidate_at_center_and_staff_inward_direction_down():
    image=np.zeros((100,150,3),np.uint8)
    image[45:56,50:61]=[255,0,0]
    image[45:56,80:91]=[0,255,0]
    crop=aligned_crop(image,[55,50],[1,0],100,size=101,scale=1.)
    assert crop[50,50,0]==255
    assert crop[80,50,1]>240
    with pytest.raises(ValueError):
        aligned_crop(image,[55,50],[0,0],100)


def test_learned_tip_ranking_can_override_the_wrong_motion_anchor():
    seed=[[.2,.5],[.8,.5]]
    baseline,trained=StaffShape(seed,300,200),StaffShape(seed,300,200)
    for tracker in (baseline,trained):
        tracker.update(mask((60,100),(240,100)),0)
    partial=mask((150,100),(240,100))
    result=baseline.update(partial,.125)
    assert result['ends'][1]['state']=='visible'
    # This observation is an intentionally shifted staff with a true left cap
    # and a body cutoff on the right. Motion alone favours the wrong boundary.
    result=trained.update(partial,.125,tip_scorer=lambda boundaries,length:[90.,80.])
    assert result['ends'][0]['state']=='visible'
    assert result['ends'][0]['x']==pytest.approx(.49,abs=.02)
    assert result['ends'][1]['state']=='inferred'
    assert result['midpoint']['state']=='inferred'
    assert result['tipScores']==[90.,80.]
    for scores in ([0.,0.],[-.02,-.19]):
        tied=StaffShape(seed,300,200)
        tied.update(mask((60,100),(240,100)),0)
        assert tied.update(partial,.125,tip_scorer=lambda *args:scores)['ends'][1]['state']=='visible'
    # Never consult the classifier for a complete shape or an empty mask.
    trained.update(mask((60,100),(240,100)),.25,tip_scorer=lambda *args:pytest.fail('full span'))
    trained.update(np.zeros((200,300),np.uint8),.5,tip_scorer=lambda *args:pytest.fail('empty mask'))


def test_bad_tip_scores_are_rejected():
    tracker=StaffShape([[.2,.5],[.8,.5]],300,200)
    tracker.update(mask((60,100),(240,100)),0)
    with pytest.raises(ValueError,match='tip scores'):
        tracker.update(mask((150,100),(240,100)),.1,tip_scorer=lambda *args:[np.nan,1])


def test_out_of_image_boundary_is_not_ranked_against_padding():
    tracker=StaffShape([[.1,.5],[.9,.5]],300,200)
    result=tracker.update(mask((150,100),(300,230)),0,tip_scorer=lambda *args:pytest.fail('padded candidate'))
    assert any(p[1]>=1 or p[0]>=1 for p in result['visibleExtent'])
    assert result['tipScores'] is None


def test_training_and_checkpoint_roundtrip_need_no_network(tmp_path,monkeypatch):
    torch.set_num_threads(2)
    features=np.array([[-2.,0.],[-1.,0.],[1.,0.],[2.,0.]],dtype=np.float32)
    center,scale,head=fit_head(features,[0,0,1,1])
    with torch.inference_mode():
        assert (head((torch.from_numpy(features)-center)/scale).flatten()>0).tolist()==[False,False,True,True]
    monkeypatch.setattr('torchvision.models._api.load_state_dict_from_url',lambda *args,**kwargs:pytest.fail('network download'))
    model=TipClassifier().eval()
    path=tmp_path/'fixture.pt'
    torch.save({'format':'klobflow-tip-v2','state_dict':model.state_dict(),'metadata':{'test':True}},path)
    loaded,metadata=TipClassifier.load(path)
    image=np.zeros((200,300,3),np.uint8)
    expected=model.score(image,[[60,100],[240,100]],180)
    actual=loaded.score(image,[[60,100],[240,100]],180)
    assert np.array_equal(expected,actual)
    assert metadata['test']
    torch.save({'format':'klobflow-tip-v1'},path)
    with pytest.raises(ValueError,match='Unsupported'):
        TipClassifier.load(path)
