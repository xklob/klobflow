package com.caleb.klobflow

import kotlin.math.*

/** A final scoring gate. Never changes endpoints or the association/motion predictor. */
internal class CapOcclusionGuard {
    private data class LengthSample(val time:Long,val length:Double,val angle:Double)
    private data class CapSample(val time:Long,val width:Double,val ratio:Double)
    private val lengthHistory=ArrayList<LengthSample>()
    private val capHistory=ArrayList<CapSample>()
    private var latched=false
    private var clearFrames=0
    private var updatedAt:Long?=null

    fun reset(){lengthHistory.clear();capHistory.clear();latched=false;clearFrames=0;updatedAt=null}
    private fun precise(s:Segment?)=s!=null && s.confidence>=.55 && !s.blurred && !s.occluded
    private fun quantile(values:List<Double>,q:Double):Double {
        val sorted=values.sorted();val index=(sorted.size-1)*q;val lower=floor(index).toInt();val fraction=index-lower
        return sorted[lower]*(1-fraction)+sorted[min(sorted.lastIndex,lower+1)]*fraction
    }

    fun update(segment:Segment?,time:Long):Segment? {
        if(updatedAt?.let {time<=it}==true)reset()
        updatedAt=time
        lengthHistory.removeAll {time-it.time>=4000};capHistory.removeAll {time-it.time>=4000}
        if(segment==null || segment.capEvidence==null){clearFrames=0;return segment}
        val s=segment;val evidence=s.capEvidence
        val recent=lengthHistory.filter {time-it.time>80}
        val local=recent.filter {angleDifference(s.angle,it.angle)<.3}
        val reference=if(recent.size>=12)quantile((if(local.size>=5)local else recent).map {it.length},.8)else null
        val referenceWidth=if(capHistory.size>=8)quantile(capHistory.map {it.width},.5)*evidence.pixelLength else null
        val referenceRatio=if(capHistory.size>=8)quantile(capHistory.map {it.ratio},.5)else null
        val ratio=evidence.minWidth/max(1e-9,evidence.maxWidth)
        val short=reference!=null && s.length<reference*.90
        val missing=referenceWidth!=null && referenceRatio!=null && evidence.minWidth<referenceWidth*.70 &&
            ratio<referenceRatio*.50 && evidence.maxWidth>referenceWidth*.85
        val trigger=precise(s) && short && missing && evidence.neutralPeak>=225
        if(trigger){latched=true;clearFrames=0}
        else if(latched) {
            val clear=precise(s) && referenceWidth!=null && referenceRatio!=null &&
                evidence.minWidth>=referenceWidth*.80 && ratio>=referenceRatio*.80 && evidence.neutralPeak>=230
            clearFrames=if(clear)clearFrames+1 else 0
            if(clearFrames>=2 || capHistory.isEmpty()){latched=false;clearFrames=0}
        }
        val flag=precise(s) && latched
        if(precise(s) && !flag) {
            lengthHistory.add(LengthSample(time,s.length,s.angle))
            if(evidence.minWidth>=3 && ratio>=.65 && evidence.neutralPeak>=230)
                capHistory.add(CapSample(time,evidence.minWidth/evidence.pixelLength,ratio))
        }
        return if(flag)s.copy(confidence=min(.35,s.confidence),occluded=true)else s
    }
}
