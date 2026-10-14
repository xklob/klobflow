import {defaults,Guide,Scorer} from "./core.mjs";
import {TimingCoach} from "./practice.mjs";
import {RollingErrors} from "./rolling-errors.mjs";
import {FlowStreak} from "./streak.mjs";
export {defaults};
const rollingErrors=new RollingErrors(),streakCoach=new FlowStreak(),coach=new TimingCoach(),scorer=new Scorer();let previousConfig='';
export function demoFrame(config,time){
 config={...defaults,...config};const key=JSON.stringify(config);if(key!==previousConfig){previousConfig=key;coach.reset();scorer.reset();}
 const width=960,height=720,g=new Guide(config,width,height),theta=time/1600;
 const staffs=[0,1].map(i=>{if(i>=config.staffCount)return null;const angle=i?Math.PI-theta:theta,center=config.staffCount===1?[g.aspectX*.5,.5]:[g.aspectX*(i?.66:.34),.5],v=[Math.cos(angle)*.23,Math.sin(angle)*.23];return {a:[center[0]-v[0],center[1]-v[1]],b:[center[0]+v[0],center[1]+v[1]],confidence:1};});
 const metrics=scorer.score(time,staffs,g);
 return {averagedMetrics:rollingErrors.update(time,metrics,config),streak:streakCoach.update({time,config,staffs,feedback:g.cues(staffs)}),time,width,height,staffs,feedback:g.cues(staffs),config,currentConfig:config,guide:g.json(),metrics,beat:coach.update(time,staffs,g),source:'demo',analysisFps:30,status:'Generated motion · preview of practice guides',recording:false,cameraReady:false};
}
