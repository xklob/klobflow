package com.caleb.klobflow
import org.json.JSONObject
import kotlin.math.*

data class AudioTempo(val running:Boolean=false,val bpm:Double?=null,val origin:Double=0.0,val confidence:Double=0.0,val level:Double=0.0,val at:Double=0.0,val status:String="Choose system audio to detect a tempo.") {
    fun usable(now:Double)=running && bpm!=null && confidence>=.6 && now-at in -100.0..2000.0
    fun json()=JSONObject().put("running",running).put("bpm",bpm ?: JSONObject.NULL).put("origin",origin).put("confidence",confidence).put("level",level).put("at",at).put("status",status)
}
/** Local envelope periodicity, adapted from the Prism visualizer. No audio is stored. */
class TempoAnalyzer {
    private val periodicity=TempoPeriodicity()
    private var baseline=0.0;private var peak=.02;private var lastSound=0.0;private var lastTime=0.0
    fun observe(timeMs:Double,energy:Double):AudioTempo {
        if(lastTime>0 && (timeMs-lastTime>100 || timeMs<=lastTime)){periodicity.reset();baseline=0.0;peak=.02}
        lastTime=timeMs
        val value=energy.coerceIn(0.0,1.0);baseline=baseline*.96+value*.04;peak=max(value,peak*.99)
        if(value>.003)lastSound=timeMs
        val activation=((value-baseline*.65)/max(.008,peak*.7)).coerceIn(0.0,1.0)
        if(timeMs-lastSound>1200)periodicity.reset()else periodicity.observe(timeMs/1000,activation)
        val estimate=periodicity.estimate
        val confident=estimate!=null && estimate.confidence>=.6 && timeMs-lastSound<=1200
        return AudioTempo(true,if(confident)estimate!!.bpm else null,estimate?.origin?.times(1000) ?: 0.0,estimate?.confidence ?: 0.0,value,timeMs,
            if(timeMs-lastSound>1200)"No shared audio. Play music and check the source allows capture."else if(confident)"Following system audio"else "Listening for a steady beat… allow 6–10 seconds.")
    }
}
/** Equivalent to the browser worklet's 20 ms low-band + full-band energy. */
class AudioEnvelope(private val rate:Int=48000) {
    private val size=rate/50;private val alpha=1-exp(-2*PI*180/rate)
    private var low=0.0;private var fullSum=0.0;private var lowSum=0.0;private var count=0
    fun sample(value:Double):Double? {
        low+=alpha*(value-low);fullSum+=value*value;lowSum+=low*low;count++
        if(count<size)return null
        val energy=sqrt(lowSum/count)+.35*sqrt(fullSum/count);count=0;fullSum=0.0;lowSum=0.0;return energy
    }
}

/** Sample counts provide cadence; noisy hardware timestamp updates only correct slow clock drift. */
class AudioSampleClock(private val rate:Int=48000) {
    private var origin:Double?=null
    private var anchored=false
    fun endTime(frames:Long,receivedAt:Double,hardwareOrigin:Double?):Double {
        val desired=hardwareOrigin?.takeIf {it.isFinite()}
        if(origin==null)origin=desired ?: (receivedAt-frames*1000.0/rate)
        if(desired!=null){
            if(!anchored){origin=desired;anchored=true}
            else origin=origin!!+(desired-origin!!).coerceIn(-.1,.1)
        }
        return origin!!+frames*1000.0/rate
    }
}
