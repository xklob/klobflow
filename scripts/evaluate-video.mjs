#!/usr/bin/env node
// Local diagnostic only. Requires ffmpeg/ffprobe; never uploads the input video.
import {spawn,spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {StaffDetector,StaffTracker,Scorer,Guide,defaults} from '../companion/public/core.mjs';
const [input,output='review/video-analysis.json',count='1']=process.argv.slice(2);
if(!input||!['1','2'].includes(count))throw Error('Usage: node scripts/evaluate-video.mjs VIDEO [OUTPUT.json] [1|2]');
const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate:stream_side_data=rotation:packet=pts_time','-of','json',resolve(input)],{encoding:'utf8',maxBuffer:20e6});
if(probe.status!==0)throw Error(probe.stderr||'ffprobe failed');
const metadata=JSON.parse(probe.stdout),times=metadata.packets.map(p=>Number(p.pts_time)).filter(Number.isFinite).sort((a,b)=>a-b),stream=metadata.streams[0];
const turn=Math.abs(stream.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||0)%180===90,sourceWidth=turn?stream.height:stream.width,sourceHeight=turn?stream.width:stream.height,scale=384/Math.max(sourceWidth,sourceHeight),width=Math.max(2,Math.round(sourceWidth*scale)),height=Math.max(2,Math.round(sourceHeight*scale));
const ff=spawn('ffmpeg',['-v','error','-i',resolve(input),'-vf',`scale=${width}:${height}`,'-fps_mode','passthrough','-f','rawvideo','-pix_fmt','bgra','pipe:1'],{stdio:['ignore','pipe','inherit']});
const done=new Promise((resolve,reject)=>{ff.on('error',reject);ff.on('close',code=>code?reject(Error(`ffmpeg exited ${code}`)):resolve());});
const detector=new StaffDetector(),tracker=new StaffTracker(),scorer=new Scorer(),config={...defaults,staffCount:Number(count)},frameBytes=width*height*4,rows=[];
let pending=Buffer.alloc(0),index=0;
for await(const chunk of ff.stdout){pending=Buffer.concat([pending,chunk]);while(pending.length>=frameBytes){
 const bytes=Uint8Array.from(pending.subarray(0,frameBytes)),time=1000+times[index]*1000;
 if(!Number.isFinite(time))throw Error('Decoded frames and source timestamps do not match');
 const begin=performance.now(),staffs=tracker.update(detector.detect(new Int32Array(bytes.buffer),width,height,config,tracker.hints(time,config.staffCount)),time,config.staffCount);
 rows.push({time:times[index],staffs,analysisMs:performance.now()-begin,metrics:scorer.score(time,staffs,new Guide(config,width,height))});index++;pending=pending.subarray(frameBytes);
}}
await done;
const summary={source:stream,width,height,frames:rows.length,observedFrames:rows.filter(r=>r.staffs.slice(0,config.staffCount).every(s=>s&&!s.occluded)).length,precisionFrames:rows.filter(r=>r.metrics.deviation!==null).length,note:'Observed is detector coverage, not independently measured accuracy. Images use the same 384-pixel maximum dimension as live analysis. Scores use an uncalibrated default guide.'};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({summary,config,rows}));console.log(JSON.stringify(summary,null,2));
