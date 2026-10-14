import {TempoAnalyzer} from './tempo-core.mjs';
let analyzer=new TempoAnalyzer(),lastSent=-Infinity;
self.onmessage=({data})=>{
 if(data.type==='reset'){analyzer=new TempoAnalyzer();return;}
 const result=analyzer.observe(data.time,data.energy);
 if(data.time-lastSent>=240){lastSent=data.time;self.postMessage(result);}
};
