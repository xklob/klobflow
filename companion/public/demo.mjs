import {defaults,Guide,Scorer} from "./core.mjs";
import {TimingCoach} from "./practice.mjs";
import {RollingErrors} from "./rolling-errors.mjs";
import {FlowStreak} from "./streak.mjs";
import {MovingPacer} from "./pacer.mjs";
export {defaults};
const rollingErrors=new RollingErrors(),streakCoach=new FlowStreak(),coach=new TimingCoach(),pacerCoach=new MovingPacer(),scorer=new Scorer();let previousConfig='';
export function resetDemoPacer(){pacerCoach.reset();streakCoach.reset();rollingErrors.reset();coach.reset();scorer.reset();previousConfig='';}
export function demoPacerCommand(operation,time,config){
 const c={...defaults,...config};
 pacerCoach.command(operation,time,new Guide(c,960,720));streakCoach.reset();return {ok:true,config:c};
}
export function demoFrame(config,time){
 config={...defaults,...config};const key=JSON.stringify(config);if(key!==previousConfig){previousConfig=key;coach.reset();scorer.reset();}
 const width=960,height=720,g=new Guide(config,width,height),theta=time/1600;
 const staffs=[0,1].map(i=>{if(i>=config.staffCount)return null;if(config.mode==='antispin'){const phase=theta*(i===1&&config.pacerPattern==='opposite'?-1:1)+(i===1?config.pacerOffset:0)*Math.PI/180;return {a:g.project(g.antispinPoint(Math.cos(phase),0,i)),b:g.project(g.antispinPoint(0,Math.sin(phase),i)),confidence:1};}const angle=i?Math.PI-theta:theta,center=config.staffCount===1?[g.aspectX*.5,.5]:[g.aspectX*(i?.66:.34),.5],v=[Math.cos(angle)*.23,Math.sin(angle)*.23];return {a:[center[0]-v[0],center[1]-v[1]],b:[center[0]+v[0],center[1]+v[1]],confidence:1};});
 const metrics=scorer.score(time,staffs,g);
 const pacer=pacerCoach.update(time,staffs,g),feedback=pacer.enabled?pacer.feedback:g.cues(staffs);
 return {averagedMetrics:rollingErrors.update(time,metrics,config),streak:streakCoach.update({time,config,staffs,feedback,pacer}),pacer,time,width,height,staffs,feedback,config,currentConfig:config,guide:g.json(),metrics,beat:coach.update(time,staffs,g),source:'demo',analysisFps:30,status:'Generated motion · preview of practice guides',recording:false,cameraReady:false};
}
