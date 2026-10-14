// A fixed, RAM-only baseline. Never learn from the live staff after capture.
export class BackgroundFilter {
  constructor(){this.clear();}
  clear(){this.baseline=null;this.sums=null;this.key=null;this.deadline=null;this.captureAt=null;this.count=0;this.status={state:'off',remainingMs:0};}
  begin(time){this.clear();this.deadline=time+5000;this.status={state:'countdown',remainingMs:5000};}
  apply(pixels,w,h,time,key){
    const viewKey=`${w}:${h}:${key}`;
    if(this.key!==null&&this.key!==viewKey)this.clear();
    this.key=viewKey;
    if(this.deadline!==null){
      if(time<this.deadline){this.status={state:'countdown',remainingMs:this.deadline-time};return new Int32Array(pixels.length);}
      this.captureAt??=time;this.sums??=new Int32Array(pixels.length*3);this.count++;
      for(let i=0;i<pixels.length;i++){const p=pixels[i];this.sums[i*3]+=p>>>16&255;this.sums[i*3+1]+=p>>>8&255;this.sums[i*3+2]+=p&255;}
      this.status={state:'capturing',remainingMs:Math.max(0,400-(time-this.captureAt))};
      if(time-this.captureAt>=400&&this.count>=4){
        this.baseline=new Int32Array(pixels.length);
        for(let i=0;i<pixels.length;i++)this.baseline[i]=(255<<24)|(Math.round(this.sums[i*3]/this.count)<<16)|(Math.round(this.sums[i*3+1]/this.count)<<8)|Math.round(this.sums[i*3+2]/this.count);
        this.sums=null;this.deadline=null;this.status={state:'ready',remainingMs:0};
      }
      return new Int32Array(pixels.length);
    }
    if(!this.baseline)return pixels;
    const out=new Int32Array(pixels.length);
    for(let i=0;i<pixels.length;i++){
      const p=pixels[i],b=this.baseline[i],pr=p>>>16&255,pg=p>>>8&255,pb=p&255,br=b>>>16&255,bg=b>>>8&255,bb=b&255;
      if(Math.max(Math.abs(pr-br),Math.abs(pg-bg),Math.abs(pb-bb))<=32)continue;
      const hi=Math.max(pr,pg,pb),baseHi=Math.max(br,bg,bb);
      // A captured lamp/window can dim with auto-exposure and still be the same light.
      // Newly bright foreground over a dark baseline is never removed by this rule.
      if(baseHi>=48&&hi>=24&&hi<=baseHi*1.4+16&&Math.max(Math.abs(pr/hi-br/baseHi),Math.abs(pg/hi-bg/baseHi),Math.abs(pb/hi-bb/baseHi))<=.14)continue;
      out[i]=p;
    }
    return out;
  }
}
