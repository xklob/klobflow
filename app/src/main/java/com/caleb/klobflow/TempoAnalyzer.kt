package com.caleb.klobflow
import org.json.JSONObject
import kotlin.math.*

data class AudioTempo(val running:Boolean=false,val bpm:Double?=null,val origin:Double=0.0,val confidence:Double=0.0,val level:Double=0.0,val at:Double=0.0,val status:String="Choose system audio to detect a tempo.",val historySeconds:Double=0.0,val candidateBpm:Double?=null,val holding:Boolean=false,val holdRemainingMs:Double=0.0) {
    fun usable(now:Double)=running && bpm!=null && confidence>=.6 && now-at in -100.0..2000.0 && (!holding || now-at<holdRemainingMs)
    fun json()=JSONObject().put("running",running).put("bpm",bpm ?: JSONObject.NULL).put("origin",origin).put("confidence",confidence).put("level",level).put("at",at).put("status",status).put("historySeconds",historySeconds).put("candidateBpm",candidateBpm ?: JSONObject.NULL).put("holding",holding).put("holdRemainingMs",holdRemainingMs)
}
/** Earn a bounded coast from three continuous seconds of a stable tempo, never from a brief guess. */
class TempoHold {
    private var previous:Double?=null
    private var stableSince:Double?=null
    private var stableBpm=0.0
    private var qualified:AudioTempo?=null
    fun update(state:AudioTempo):AudioTempo {
        val before=previous;val now=state.at
        if(!state.running || before!=null && now<=before){stableSince=null;qualified=null}
        previous=now
        if(!state.running)return state.copy(holding=false,holdRemainingMs=0.0)
        val live=state.bpm!=null && state.confidence>=.6
        if(live){
            // A confidently different tempo invalidates the old coast, including half/double changes.
            qualified?.let {if(abs(state.bpm!!-it.bpm!!)>it.bpm*.04)qualified=null}
            if(stableSince==null || before==null || now-before>100 || abs(state.bpm!!-stableBpm)>stableBpm*.04){stableSince=now;stableBpm=state.bpm!!}
            if(now-stableSince!!>=3000)qualified=state
            return state
        }
        stableSince=null
        val saved=qualified
        val remaining=if(saved==null)0.0 else 15000-(now-saved.at)
        if(saved!=null && remaining>0)return state.copy(bpm=saved.bpm,origin=saved.origin,confidence=saved.confidence,holding=true,holdRemainingMs=remaining,status="Holding the last steady beat")
        qualified=null
        return state
    }
}
/** Local envelope periodicity, adapted from the Prism visualizer. No audio is stored. */
class TempoAnalyzer {
    private val periodicity=TempoPeriodicity()
    private val hold=TempoHold()
    private var baseline=0.0;private var peak=.02;private var lastSound=0.0;private var lastTime=0.0;private var meterLevel=0.0
    fun observe(timeMs:Double,energy:Double):AudioTempo {
        if(lastTime>0 && (timeMs-lastTime>100 || timeMs<=lastTime)){periodicity.reset();baseline=0.0;peak=.02;meterLevel=0.0}
        // Retain brief audio peaks between UI updates without feeding smoothing into tempo detection.
        meterLevel=max(energy.coerceIn(0.0,1.0),meterLevel*exp(-(timeMs-lastTime).coerceAtLeast(0.0)/180))
        lastTime=timeMs
        val value=energy.coerceIn(0.0,1.0);baseline=baseline*.96+value*.04;peak=max(value,peak*.99)
        if(value>.003)lastSound=timeMs
        val activation=((value-baseline*.65)/max(.008,peak*.7)).coerceIn(0.0,1.0)
        if(timeMs-lastSound>1200)periodicity.reset()else periodicity.observe(timeMs/1000,activation)
        val estimate=periodicity.estimate
        val confident=estimate!=null && estimate.confidence>=.6 && timeMs-lastSound<=1200
        return hold.update(AudioTempo(true,if(confident)estimate!!.bpm else null,estimate?.origin?.times(1000) ?: 0.0,estimate?.confidence ?: 0.0,meterLevel,timeMs,
            if(timeMs-lastSound>1200)"No shared audio. Play music and check the source allows capture."else if(confident)"Following system audio"else "Listening for a steady beat… allow 6–10 seconds.",periodicity.historySeconds,estimate?.bpm))
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
