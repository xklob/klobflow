// Envelope periodicity adapted from the local Prism visualizer's native engine.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
export class TempoPeriodicity {
 constructor(){this.reset();}
 reset(){this.frames=[];this.lastFit=-Infinity;this.estimate=null;}
 get historySeconds(){return this.frames.length<2?0:clamp(this.frames.at(-1).time-this.frames[0].time,0,8);}
 observe(time,value){this.frames.push({time,value:clamp(value,0,1)});while(this.frames.length&&time-this.frames[0].time>8+1e-6)this.frames.shift();if(time-this.lastFit<.24-1e-6)return;this.lastFit=time;this.estimate=this.fit();}
 fit(){
  if(this.frames.length<120)return null;const samples=this.frames,span=samples.at(-1).time-samples[0].time,step=span/(samples.length-1);if(step<.015||step>.025)return null;
  const avg=mean(samples.map(s=>s.value)),values=samples.map(s=>s.value-avg);if(mean(values.map(v=>v*v))<.0004)return null;
  // Reject a flat last 1.2 seconds even if the initial normalization ramp still has variance.
  const recent=samples.slice(-60).map(s=>s.value),recentMean=mean(recent);if(mean(recent.map(v=>(v-recentMean)**2))<.0004)return null;
  const maximum=Math.min(Math.trunc(3.05/step)+2,Math.floor(values.length/2)),correlation=new Float64Array(maximum+1);
  for(let lag=1;lag<=maximum;lag++){let product=0,left=0,right=0;for(let i=lag;i<values.length;i++){const a=values[i],b=values[i-lag];product+=a*b;left+=a*a;right+=b*b;}correlation[lag]=product/Math.sqrt(Math.max(1e-12,left*right));}
  const at=lag=>{const n=Math.trunc(lag);if(n<2||n+2>maximum)return null;const d=lag-n,a=correlation[n-1],b=correlation[n],c=correlation[n+1],e=correlation[n+2];return clamp(.5*(2*b+(c-a)*d+(2*a-5*b+4*c-e)*d*d+(-a+3*b-3*c+e)*d*d*d),-1,1);};
  const score=bpm=>{const lag=60/bpm/step;let total=0,weight=0;for(let multiple=1;multiple<=3;multiple++){const value=at(lag*multiple);if(value===null)continue;const w=multiple===1?.5:multiple===2?.3:.2;total+=value*w;weight+=w;}return weight?total/weight:-1;};
  let bpm=120,quality=-1,best=-1;
  for(let candidate=120;candidate<=400;candidate++){const rate=candidate/2,c=score(rate);if(c>best){best=c;quality=c;bpm=rate;}}
  if(bpm*2<=200&&score(bpm*2)>=Math.max(.45,quality*.85)){bpm*=2;quality=score(bpm);}
  if(quality<.43||span*bpm/60<5-1e-6)return null;
  let competitor=-1;for(let candidate=120;candidate<=400;candidate++){const rate=candidate/2,ratio=Math.log(rate/bpm),value=score(rate);if(Math.abs(ratio)>.10&&Math.abs(Math.abs(ratio)-Math.log(2))>.10&&Math.abs(Math.abs(ratio)-Math.log(3))>.10&&value>=score(rate-.5)&&value>=score(rate+.5))competitor=Math.max(competitor,value);}
  const separation=clamp((quality-competitor)/.30,0,1),period=60/bpm,now=samples.at(-1).time,sums=new Float64Array(64),weights=new Float64Array(64);
  for(const sample of samples){const position=(sample.time-now)/period,phase=(position-Math.floor(position))*64,bin=clamp(Math.trunc(phase),0,63),fraction=phase-bin,weight=Math.exp((sample.time-now)/3.5),value=sample.value**2;sums[bin]+=value*weight*(1-fraction);weights[bin]+=weight*(1-fraction);sums[(bin+1)%64]+=value*weight*fraction;weights[(bin+1)%64]+=weight*fraction;}
  const folded=Array.from({length:64},(_,bin)=>{let sum=0,weight=0;for(let offset=-5;offset<=5;offset++){const kernel=Math.exp(-.5*(offset/2)**2),index=(bin+offset+64)%64;sum+=sums[index]*kernel;weight+=weights[index]*kernel;}return sum/Math.max(1e-9,weight);});
  const peak=folded.indexOf(Math.max(...folded)),contrast=clamp((folded[peak]-mean(folded))/Math.max(.001,folded[peak]),0,1),count=Math.max(3,Math.trunc(span*bpm/60)),strength=mean(samples.map(s=>s.value).sort((a,b)=>b-a).slice(0,count)),confidence=(.5*quality+.5*separation)*(.85+.15*contrast)*clamp(strength/.30,0,1);
  return {bpm,origin:now+peak/64*period,confidence};
 }
}
// Earn a bounded coast from three continuous seconds of stable tempo, never from a brief guess.
export class TempoHold {
 constructor(){this.previous=null;this.stableSince=null;this.stableBpm=0;this.qualified=null;}
 update(state){
  const before=this.previous,now=state.at;
  if(!state.running||(before!==null&&now<=before)){this.stableSince=null;this.qualified=null;}
  this.previous=now;
  if(!state.running)return {...state,holding:false,holdRemainingMs:0};
  const live=state.bpm!==null&&state.confidence>=.6;
  if(live){
   if(this.qualified&&Math.abs(state.bpm-this.qualified.bpm)>this.qualified.bpm*.04)this.qualified=null;
   if(this.stableSince===null||before===null||now-before>100||Math.abs(state.bpm-this.stableBpm)>this.stableBpm*.04){this.stableSince=now;this.stableBpm=state.bpm;}
   if(now-this.stableSince>=3000)this.qualified=state;
   return state;
  }
  this.stableSince=null;
  const saved=this.qualified,remaining=saved?15000-(now-saved.at):0;
  if(saved&&remaining>0)return {...state,bpm:saved.bpm,origin:saved.origin,confidence:saved.confidence,holding:true,holdRemainingMs:remaining,status:'Holding the last steady beat'};
  this.qualified=null;
  return state;
 }
}
export class TempoAnalyzer {
 constructor(){this.periodicity=new TempoPeriodicity();this.hold=new TempoHold();this.baseline=0;this.peak=.02;this.lastSound=0;this.lastTime=0;this.meterLevel=0;}
 observe(timeMs,energy){
  if(this.lastTime>0&&(timeMs-this.lastTime>100||timeMs<=this.lastTime)){this.periodicity.reset();this.baseline=0;this.peak=.02;this.meterLevel=0;}
  // Keep short transients visible between UI updates; tempo still receives the unsmoothed energy.
  this.meterLevel=Math.max(clamp(energy,0,1),this.meterLevel*Math.exp(-Math.max(0,timeMs-this.lastTime)/180));this.lastTime=timeMs;
  const value=clamp(energy,0,1);this.baseline=this.baseline*.96+value*.04;this.peak=Math.max(value,this.peak*.99);if(value>.003)this.lastSound=timeMs;
  const activation=clamp((value-this.baseline*.65)/Math.max(.008,this.peak*.7),0,1);
  if(timeMs-this.lastSound>1200)this.periodicity.reset();else this.periodicity.observe(timeMs/1000,activation);
  const estimate=this.periodicity.estimate,confident=estimate&&estimate.confidence>=.6&&timeMs-this.lastSound<=1200;
  return this.hold.update({running:true,bpm:confident?estimate.bpm:null,origin:(estimate?.origin||0)*1000,confidence:estimate?.confidence||0,level:this.meterLevel,at:timeMs,historySeconds:this.periodicity.historySeconds,candidateBpm:estimate?.bpm??null,holding:false,holdRemainingMs:0,status:timeMs-this.lastSound>1200?'No shared audio. Play music and check the source allows capture.':confident?'Following system audio':'Listening for a steady beat… allow 6–10 seconds.'});
 }
}
export class AudioEnvelope {
 constructor(rate=48000){this.size=Math.floor(rate/50);this.alpha=1-Math.exp(-2*Math.PI*180/rate);this.low=0;this.fullSum=0;this.lowSum=0;this.count=0;}
 sample(value){this.low+=this.alpha*(value-this.low);this.fullSum+=value*value;this.lowSum+=this.low*this.low;this.count++;if(this.count<this.size)return null;const energy=Math.sqrt(this.lowSum/this.count)+.35*Math.sqrt(this.fullSum/this.count);this.count=0;this.fullSum=0;this.lowSum=0;return energy;}
}
