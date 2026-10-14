// Display-only, five-second mean of valid observations; current uncertainty stays null.
export class RollingErrors {
 constructor(){this.reset();}
 reset(){this.samples=[];this.key='';}
 update(time,metrics,config){
  const key=JSON.stringify(['mode','staffCount','cx','cy','scale','rotation','cubeDepth','circleSeparation','diagonals','planeCorners','planeAspect','calibrationImageAspect','calibrationRotation','facing','mirror','zoom','led','threshold','minLength','staffColors'].map(k=>config[k]));
  if(key!==this.key||time<(this.samples.at(-1)?.time??time))this.reset();
  this.key=key;if(this.samples.at(-1)?.time===time)this.samples.pop();
  this.samples.push({time,metrics});this.samples=this.samples.filter(s=>time-s.time<=5000);
  const result={...metrics};
  for(const key of ['deviation','angle','symmetry']){
   if(!Number.isFinite(metrics[key])){result[key]=null;continue;}
   const values=this.samples.map(s=>s.metrics[key]).filter(Number.isFinite);
   result[key]=values.reduce((sum,n)=>sum+n,0)/values.length;
  }
  return result;
 }
}
