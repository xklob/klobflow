import {TempoAnalyzer} from './tempo-core.mjs';
let analyzer=new TempoAnalyzer(),lastSent=-Infinity;
self.onmessage=({data})=>{
 if(data.type==='reset'){analyzer=new TempoAnalyzer();lastSent=-Infinity;return;}
 const result=analyzer.observe(data.time,data.energy);
 if(data.time-lastSent>=80||data.time<lastSent){lastSent=data.time;self.postMessage(result);}
};
