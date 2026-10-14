export class SystemAudio {
 constructor(onUpdate=()=>{}){this.onUpdate=onUpdate;this.active=false;this.state=null;this.generation=0;window.addEventListener('pagehide',()=>this.stop());}
 async start(){
  // Invoke directly from the user's click, before awaiting setup, to retain browser activation.
  if(!navigator.mediaDevices?.getDisplayMedia)throw Error('System/tab audio capture is unavailable here. Try Chrome or Edge on localhost.');
  const generation=++this.generation;
  let stream;
  try{
   stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:1,max:1}},audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,suppressLocalAudioPlayback:false},systemAudio:'include',selfBrowserSurface:'exclude',surfaceSwitching:'exclude'});
   if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
   if(!stream.getAudioTracks().length){stream.getTracks().forEach(t=>t.stop());throw Error('No audio was shared. Choose a tab or screen with Share audio enabled, or use manual BPM.');}
   this.stream=stream;this.context=new AudioContext();await this.context.resume();
   if(!this.context.audioWorklet)throw Error('Audio analysis needs AudioWorklet support. Try Chrome or Edge.');
   await this.context.audioWorklet.addModule('/audio-worklet.mjs');
   if(generation!==this.generation)return;
   this.worker=new Worker(new URL('./tempo-worker.mjs',import.meta.url),{type:'module'});
   this.worker.onmessage=({data})=>{if(generation!==this.generation)return;this.state=data;this.onUpdate(data);};
   this.worker.onerror=()=>this.stop('Audio analysis stopped. Connect audio again.');
   this.audioOrigin=performance.now()-this.context.currentTime*1000;
   this.source=this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
   this.processor=new AudioWorkletNode(this.context,'klobflow-envelope');
   this.processor.port.onmessage=({data})=>{
    if(generation!==this.generation)return;
    const desired=performance.now()-this.context.currentTime*1000;
    this.audioOrigin+=Math.max(-.1,Math.min(.1,desired-this.audioOrigin));
    this.worker.postMessage({time:data.time+this.audioOrigin,energy:data.energy});
   };
   // Keep the processor running with zero output; do not echo captured music.
   this.sink=this.context.createGain();this.sink.gain.value=0;this.source.connect(this.processor);this.processor.connect(this.sink);this.sink.connect(this.context.destination);
   for(const track of stream.getTracks())track.onended=()=>this.stop('Audio sharing ended. Connect again or choose manual BPM.');
   this.context.onstatechange=()=>{if(this.active&&this.context.state!=='running')this.stop('Audio processing paused. Reconnect audio or use manual BPM.');};
   this.active=true;this.onUpdate({running:true,bpm:null,confidence:0,at:performance.now(),status:'Listening for a steady beat… allow 6–10 seconds.'});
  }catch(e){stream?.getTracks().forEach(t=>t.stop());if(generation===this.generation)this.stop();throw Error(e.name==='NotAllowedError'?'Audio sharing was canceled. Your manual BPM is still available.':e.message);}
 }
 stop(status='Audio stopped. Choose manual BPM or connect again.'){
  ++this.generation;this.active=false;this.worker?.terminate();this.worker=null;this.source?.disconnect();this.processor?.disconnect();this.sink?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
  const context=this.context;this.context=null;if(context&&context.state!=='closed')context.close().catch(()=>{});
  this.state={running:false,bpm:null,confidence:0,at:performance.now(),status};this.onUpdate(this.state);
 }
}
