import {AudioEnvelope} from './tempo-core.mjs';
class KlobflowEnvelope extends AudioWorkletProcessor {
 constructor(){super();this.envelope=new AudioEnvelope(sampleRate);}
 process(inputs){
  const channels=inputs[0];if(!channels?.length)return true;
  for(let i=0;i<channels[0].length;i++){
   let value=0;for(const channel of channels)value+=channel[i];value/=channels.length;
   const energy=this.envelope.sample(value);
   if(energy!==null)this.port.postMessage({time:(currentFrame+i+1)/sampleRate*1000,energy});
  }
  return true;
 }
}
registerProcessor('klobflow-envelope',KlobflowEnvelope);
