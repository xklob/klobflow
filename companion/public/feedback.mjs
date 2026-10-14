// Presentation stability is separate from measurement: uncertain scores always pause immediately.
export class AlignmentFeedback {
 constructor(){this.reset();}
 reset(){this.time=-1;this.key='';this.clearSince=null;this.onSince=[];this.on=[];this.alignedSince=null;}
 update(frame){
  const {time,config,staffs}=frame,key=JSON.stringify([config.mode,config.staffCount,config.tolerance,config.planeCorners]);
  if(time<this.time||key!==this.key)this.reset();this.time=time;this.key=key;
  const paused={state:'paused',title:'PRECISION PAUSED',detail:'Wait for clear tips. A dashed staff means motion blur, not an alignment error. Shorter exposure helps.',tips:[]};
  if(config.mode==='free')return {...paused,state:'free',title:'FREE FLOW',detail:'Trails show your movement. Choose Grid, Circles, or Cube for an alignment target.'};
  const cues=frame.feedback||[],count=config.staffCount||2;
  if(staffs.slice(0,count).some(s=>!s||s.occluded||s.blurred||s.confidence<.55)||cues.length!==count*2){this.clearSince=null;this.onSince=[];this.on=[];this.alignedSince=null;return paused;}
  this.clearSince??=time;
  if(time-this.clearSince<650)return paused;
  const tips=cues.map((cue,i)=>{
   if(cue.error>config.tolerance){this.on[i]=false;this.onSince[i]=null;}
   else if(!this.on[i]){if(cue.error<=config.tolerance*.85){this.onSince[i]??=time;if(time-this.onSince[i]>=300)this.on[i]=true;}else this.onSince[i]=null;}
   return {...cue,onTarget:!!this.on[i]};
  });
  if(tips.every(t=>t.onTarget))this.alignedSince??=time;else this.alignedSince=null;
  const aligned=this.alignedSince!==null&&time-this.alignedSince>=1200;
  return {state:aligned?'aligned':'adjust',title:aligned?'ON GUIDE':'MOVE ORANGE TIPS TOWARD WHITE TARGETS',detail:aligned?'Your tips are inside the target tolerance. Keep tracing the white guide.':'The colored rings are your actual tips. Follow each orange arrow to its white bullseye. Green ON GUIDE labels mean that tip is aligned.',tips};
 }
}
