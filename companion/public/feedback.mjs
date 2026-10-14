// Presentation stability is separate from measurement: uncertain scores always pause immediately.
// The tracker already requires consecutive observed frames. Text fades must not delay valid measurements.
const RANK={uncertain:1,blur:2,hidden:3,missing:4};
const letter=i=>'AB'[i];
// The most limiting tracking problem in this frame, or null when every staff is clear.
export function trackingIssue(staffs,count){
 let issue=null,missing=0;
 for(let i=0;i<count;i++){
  const s=staffs[i],kind=!s?'missing':s.occluded?'hidden':s.blurred?'blur':s.confidence<.55?'uncertain':null;
  if(kind==='missing')missing++;
  if(kind&&(!issue||RANK[kind]>RANK[issue.kind]))issue={kind,staff:i};
 }
 if(issue&&missing===count)issue={kind:'missing',staff:-1};
 return issue;
}
// While the background snapshot runs, the staves must stay out of view: never ask for them back.
export const capturingBackground=frame=>['countdown','capturing'].includes(frame?.background?.state);
function describeIssue(issue,count){
 const tone='warn';
 if(issue.kind==='missing')return {tone,title:issue.staff<0?(count===1?'NO STAFF FOUND':'NO STAVES FOUND'):count===1?'STAFF NOT FOUND':`STAFF ${letter(issue.staff)} NOT FOUND`,detail:'Keep the whole staff lit and in frame. Scores pause until it is found.'};
 if(issue.kind==='hidden')return {tone,title:'END HIDDEN',detail:'An end is covered or outside the frame. Keep both ends in view.'};
 if(issue.kind==='blur')return {tone,title:'ENDS UNCLEAR',detail:'The glow is visible, but both ends cannot be located reliably. This frame is excluded.'};
 if(issue.kind==='uncertain')return {tone,title:'UNSURE',detail:'Crossing staves or a faint shape. Scores pause until tracking is sure.'};
 if(issue.kind==='outside')return {tone,title:'OUTSIDE PLANE',detail:'A tip left the calibrated rectangle. Scores pause until every tip is inside it.'};
 return {tone,title:'LOCKING ON',detail:'Keep your staves in view while tracking confirms them.'};
}
export class AlignmentFeedback {
 constructor(){this.reset();}
 reset(){this.time=-1;this.key='';this.onSince=[];this.on=[];this.alignedSince=null;this.lastIssue=null;this.samples=[];}
 update(frame){
  const {time,config,staffs}=frame,key=JSON.stringify([config.mode,config.staffCount,config.tolerance,config.planeCorners,config.cx,config.cy,config.scale,config.rotation,config.circleSeparation,frame.width,frame.height,config.staffColors,config.threshold,config.minLength,config.led,config.facing,config.mirror,config.zoom]);
  if(time<this.time||key!==this.key)this.reset();this.time=time;this.key=key;
  const cues=frame.feedback||[],count=config.staffCount||2,free=config.mode==='free';
  const issue=trackingIssue(staffs,count)??(!free&&cues.length!==count*2?{kind:'outside',staff:-1}:null);
  if(issue){this.onSince=[];this.on=[];this.alignedSince=null;this.lastIssue=issue;}
  const snapshot=capturingBackground(frame),confirmed=!issue&&!snapshot;
  this.samples=this.samples.filter(s=>time-s.time<=5000&&s.time!==time);
  if(snapshot)this.samples=[];else this.samples.push({time,valid:confirmed,on:confirmed&&cues.length===count*2&&cues.every(c=>c.error<=config.tolerance)});
  const measured=this.samples.filter(s=>s.valid),recent=measured.length>=3&&time-measured.at(-1).time<=(issue?.kind==='hidden'?1500:1000);
  const coverage=Math.round(measured.length/Math.max(1,this.samples.length)*100),onPercent=measured.length?Math.round(measured.filter(s=>s.on).length/measured.length*100):0;
  const summary=recent&&!free&&!snapshot?{tone:onPercent>=80?'ok':'warn',title:`${onPercent}% ON TARGET`,detail:`Of measured frames in the last 5 seconds. Tolerance: ${config.tolerance}% of guide width. Unclear frames are excluded.`}:null;
  // Text changes are held and faded by StableText, independently of current measurements.
  const shown=snapshot?{tone:'wait',title:'BACKGROUND SNAPSHOT',detail:'Move your staves out of view and keep the camera still.'}:confirmed?{tone:'ok',title:'CLEAR',detail:count===1?'Your staff and both of its ends are sharp.':'Both staves and all four ends are sharp.'}:describeIssue(issue??this.lastIssue??{kind:'starting'},count);
  if(recent&&!snapshot){shown.tone=coverage>=80?'ok':'warn';shown.title=`${coverage}% MEASURED`;shown.detail='Frames with both ends located, over the last 5 seconds. Unclear frames pause live scores and rings.';}
  const tracking={...shown,key:`${shown.tone}|${shown.title}`,valid:!issue&&!snapshot,confirmed:confirmed&&!snapshot};
  // `cues` is true only when this text refers to correction marks that are actually drawn.
  const result=(state,title,detail,tips=[],cues=false)=>({state,title,detail,tips,tracking,cues,summary});
  if(free)return result('free','FREE FLOW',config.trails===false?'No alignment score here. Choose Grid, Circles or Cube for targets.':'No alignment score here. Faint curves show where each tip traveled.');
  if(snapshot)return result('paused','PRECISION PAUSED','Scores resume after the background snapshot.');
  if(!confirmed)return result('paused','PRECISION PAUSED','No current measurement. Keep both ends lit and in view; unclear frames are excluded.');
  const tips=cues.map((cue,i)=>{
   if(cue.error>config.tolerance){this.on[i]=false;this.onSince[i]=null;}
   else if(!this.on[i]){if(cue.error<=config.tolerance*.85){this.onSince[i]??=time;if(time-this.onSince[i]>=300)this.on[i]=true;}else this.onSince[i]=null;}
   return {...cue,onTarget:!!this.on[i]};
  });
  if(tips.every(t=>t.onTarget))this.alignedSince??=time;else this.alignedSince=null;
  const aligned=this.alignedSince!==null&&time-this.alignedSince>=1200,cuesShown=config.showFeedback!==false;
  if(aligned)return result('aligned','ON GUIDE','Every tip is within tolerance. Keep tracing the guide.',tips);
  // Every tip is inside tolerance but not yet confirmed: no correction marks are drawn, so name none.
  if(tips.every(t=>t.error<=config.tolerance))return result('settling','TIPS ON TARGET','Every tip is within tolerance. Keep tracing the guide to confirm ON GUIDE.',tips);
  return result('adjust','OFF GUIDE',cuesShown?'Move each amber-ringed tip along its arrow into the white TARGET ring.':'Some tips are outside tolerance. Turn on Alignment cues to see where to move.',tips,cuesShown);
 }
}
// Rate-limits text changes so rapid events never restart a fade each frame. Urgent changes show at once;
// others wait until the current message has been visible for `hold` ms, then show only the latest target.
export class StableText {
 constructor(hold=2600){this.hold=hold;this.reset();}
 reset(){this.shown=null;this.since=-Infinity;}
 update(now,next,urgent=false){
  if(this.shown?.key===next.key)return null;
  if(this.shown&&!urgent&&now-this.since<this.hold)return null;
  const first=!this.shown;this.shown=next;this.since=now;return {content:next,urgent,first};
 }
 force(now,next){if(this.shown?.key===next.key)return null;this.shown=next;this.since=now;return {content:next,urgent:true,first:true};}
}
// Screen direction from a tip toward its target, with hysteresis so the word does not flicker at sector edges.
const SECTORS=[['→','RIGHT'],['↘','DOWN-RIGHT'],['↓','DOWN'],['↙','DOWN-LEFT'],['←','LEFT'],['↖','UP-LEFT'],['↑','UP'],['↗','UP-RIGHT']];
export function direction(dx,dy,previous=-1){
 const angle=(Math.atan2(dy,dx)+Math.PI*2)%(Math.PI*2),sector=Math.round(angle/(Math.PI/4))%8;
 if(previous>=0){const center=previous*Math.PI/4,delta=Math.abs(Math.atan2(Math.sin(angle-center),Math.cos(angle-center)));if(delta<Math.PI/8+Math.PI/14)return {sector:previous,glyph:SECTORS[previous][0],word:SECTORS[previous][1]};}
 return {sector,glyph:SECTORS[sector][0],word:SECTORS[sector][1]};
}
