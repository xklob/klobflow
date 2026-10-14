export const staffColorNames = ['red','orange','yellow','green','cyan','blue','purple','pink','white'];

// Retain only selected hues, plus white LED cores next to matching colored glow.
// An integral image keeps the small halo allowance linear in the analysis image size.
export function filterStaffColors(pixels,w,h,colors=[]) {
  if(!colors.length)return pixels;
  const selected=new Set(colors),matched=new Uint8Array(w*h),neutral=new Uint8Array(w*h),integral=new Int32Array((w+1)*(h+1));
  const hasWhite=selected.has('white'),stride=w+1;
  for(let y=0;y<h;y++){
    let row=0;
    for(let x=0;x<w;x++){
      const i=y*w+x,p=pixels[i],r=p>>>16&255,g=p>>>8&255,b=p&255,hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
      const pale=hi>=24&&delta<=hi*.2;neutral[i]=pale?1:0;
      let match=false;
      if(hi>=24&&delta>hi*.2){
        const hue=((hi===r?(g-b)/delta:hi===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360;
        match=(selected.has('red')&&(hue<25||hue>=345))||(selected.has('orange')&&hue>=20&&hue<48)||(selected.has('yellow')&&hue>=42&&hue<75)||(selected.has('green')&&hue>=70&&hue<165)||(selected.has('cyan')&&hue>=160&&hue<200)||(selected.has('blue')&&hue>=195&&hue<260)||(selected.has('purple')&&hue>=255&&hue<295)||(selected.has('pink')&&hue>=290&&hue<350);
      }
      matched[i]=match||(hasWhite&&pale)?1:0;
      row+=match?1:0;integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;
    }
  }
  const out=new Int32Array(pixels.length),radius=3;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if(matched[i]){out[i]=pixels[i];continue;}
    if(!neutral[i])continue;
    const left=Math.max(0,x-radius),right=Math.min(w,x+radius+1),top=Math.max(0,y-radius),bottom=Math.min(h,y+radius+1);
    const nearby=integral[bottom*stride+right]-integral[top*stride+right]-integral[bottom*stride+left]+integral[top*stride+left];
    if(nearby>=2)out[i]=pixels[i];
  }
  return out;
}
