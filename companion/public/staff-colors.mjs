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

  // Retain a bright white core only when selected hue surrounds its boundary.
  // A local three-pixel halo alone can hollow out a large overexposed end cap.
  if(!hasWhite){
    const bright=new Uint8Array(pixels.length),visited=new Uint8Array(pixels.length),queue=new Int32Array(pixels.length);
    for(let i=0;i<pixels.length;i++){const p=pixels[i];bright[i]=neutral[i]&&Math.max(p>>>16&255,p>>>8&255,p&255)>=160?1:0;}
    for(let first=0;first<pixels.length;first++)if(bright[first]&&!visited[first]){
      let head=0,tail=1,boundary=0,supported=0,clipped=false;queue[0]=first;visited[first]=1;
      while(head<tail){const at=queue[head++],x=at%w,y=Math.floor(at/w);if(x===0||x===w-1||y===0||y===h-1)clipped=true;
        let edge=false,color=false;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;const i=yy*w+xx;
          if(bright[i]){if(!visited[i]){visited[i]=1;queue[tail++]=i;}}
          else{edge=true;const p=pixels[i];if(matched[i]&&Math.max(p>>>16&255,p>>>8&255,p&255)>=80)color=true;}
        }
        if(edge){boundary++;if(color)supported++;}
      }
      if(!clipped&&tail<=w*h*.03&&boundary>0&&supported/boundary>=.35)for(let i=0;i<tail;i++)out[queue[i]]=pixels[queue[i]];
    }
  }
  return out;
}
