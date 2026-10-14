// Integrate a rotating, glowing rod over an exposure, including brightness dilution.
// This deliberately differs from the sharp translated lines in the original camera test.
export function spinFrame({width=320,height=240,angle=0,sweep=0,centers=[[2/3,.5]],directions=[1,1],length=.62,radius=.012,gap=0,white=false,rainbow=false}={}) {
 const pixels=new Int32Array(width*height),short=Math.min(width,height),samples=sweep?17:1;
 const poses=centers.map((center,n)=>Array.from({length:samples},(_,i)=>{
  const a=angle*(directions[n]||1)+(samples===1?0:sweep*(i/(samples-1)-.5));return {center,cos:Math.cos(a),sin:Math.sin(a)};
 }));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const rgb=[16,21,16];
  poses.forEach((staff,n)=>{const energy=[0,0,0];for(let j=0;j<staff.length;j++){const p=staff[j],dx=x/short-p.center[0],dy=y/short-p.center[1],along=dx*p.cos+dy*p.sin,across=-dx*p.sin+dy*p.cos;if(Math.abs(along)>length/2||Math.abs(along)<gap/2||Math.abs(across)>radius)continue;
   const color=rainbow?[0,1,2].map(c=>Math.round(135+110*Math.sin(along/length*Math.PI*4+angle*3+j*.07+c*Math.PI*2/3))):white?[240,240,240]:n?[181,163,255]:[182,243,107];for(let c=0;c<3;c++)energy[c]+=color[c]-[16,21,16][c];}
   for(let c=0;c<3;c++)rgb[c]+=Math.round(energy[c]/samples);
  });
  pixels[y*width+x]=(255<<24)|(Math.min(255,rgb[0])<<16)|(Math.min(255,rgb[1])<<8)|Math.min(255,rgb[2]);
 }
 return pixels;
}
