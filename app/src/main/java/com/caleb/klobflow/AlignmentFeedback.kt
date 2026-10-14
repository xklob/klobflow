package com.caleb.klobflow

data class Coaching(val state:String,val title:String,val detail:String,val tips:List<TipCue> = emptyList())

/** Presentation hysteresis never changes scores or makes uncertain observations valid. */
class AlignmentFeedback {
    private var time=-1L;private var key="";private var clearSince:Long?=null
    private var onSince=arrayOfNulls<Long>(4);private var on=BooleanArray(4);private var alignedSince:Long?=null
    private fun clear(){clearSince=null;onSince=arrayOfNulls(4);on=BooleanArray(4);alignedSince=null}
    fun update(t:Long,staffs:List<Segment?>,guide:Guide):Coaching {
        val c=guide.config;val nextKey="${c.mode}/${c.staffCount}/${c.tolerance}/${c.planeCorners}"
        if(t<time||nextKey!=key)clear();time=t;key=nextKey
        val paused=Coaching("paused","PRECISION PAUSED","Wait for clear tips. A dashed staff means motion blur, not an alignment error. Shorter exposure helps.")
        if(c.mode=="free")return paused.copy(state="free",title="FREE FLOW",detail="Trails show your movement. Choose Grid, Circles, or Cube for an alignment target.")
        val cues=guide.cues(staffs)
        if(staffs.take(c.staffCount).any {it==null||it.occluded||it.blurred||it.confidence<.55}||cues.size!=c.staffCount*2){clear();return paused}
        if(clearSince==null)clearSince=t
        if(t-clearSince!!<650)return paused
        val tips=cues.mapIndexed {i,cue->
            if(cue.error>c.tolerance){on[i]=false;onSince[i]=null}
            else if(!on[i]){if(cue.error<=c.tolerance*.85){if(onSince[i]==null)onSince[i]=t;if(t-onSince[i]!!>=300)on[i]=true}else onSince[i]=null}
            cue.copy(onTarget=on[i])
        }
        if(tips.all {it.onTarget}){if(alignedSince==null)alignedSince=t}else alignedSince=null
        val aligned=alignedSince?.let {t-it>=1200}==true
        return Coaching(if(aligned)"aligned"else"adjust",if(aligned)"ON GUIDE"else"MOVE ORANGE TIPS TOWARD WHITE TARGETS",if(aligned)"Your tips are inside the target tolerance. Keep tracing the white guide."else"The colored rings are your actual tips. Follow each orange arrow to its white bullseye. Green ON GUIDE labels mean that tip is aligned.",tips)
    }
}
