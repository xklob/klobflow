package com.caleb.klobflow

import kotlin.math.*
import org.json.JSONObject

data class StreakFrame(val state:String="ready",val seconds:Double=0.0,val bestSeconds:Double=0.0,val level:Int=1,val energy:Double=0.0,val progress:Double=0.0) {
    fun json()=JSONObject().put("state",state).put("seconds",seconds).put("bestSeconds",bestSeconds).put("level",level).put("energy",energy).put("progress",progress)
    val label get()=when(state){
        "free"->"FREE FLOW · trails without alignment streaks"
        "paused"->"STREAK PAUSED · waiting for clear tips"
        "off"->"STREAK EFFECTS OFF"
        "ready"->"BUILD YOUR STREAK · keep every tip on the guide"
        else->"FLOW STREAK · %.1fs · LEVEL %d".format(seconds,level)
    }
}
/** Cosmetic rewards never alter precision scores or award time across missing frames. */
class FlowStreak {
    private var time:Long?=null;private var key="";private var ms=0L;private var best=0L;private var energy=0.0
    private var previousGood=false;private var uncertainSince:Long?=null
    fun reset(clearBest:Boolean=true){time=null;key="";ms=0;if(clearBest)best=0;energy=0.0;previousGood=false;uncertainSince=null}
    fun update(t:Long,staffs:List<Segment?>,g:Guide):StreakFrame {
        val c=g.config
        val nextKey=listOf(c.mode,c.staffCount,c.tolerance,c.cx,c.cy,c.scale,c.rotation,c.cubeDepth,c.circleSeparation,c.planeCorners,c.planeAspect,c.calibrationRotation,c.calibrationImageAspect,c.diagonals,c.facing,c.mirror,c.zoom,c.streakEffects,c.staffColors,c.led,c.threshold,c.minLength).toString()
        if(nextKey!=key||time?.let {t<it}==true)reset()
        else if(time?.let {t-it>250}==true)reset(false)
        val dt=time?.let {(t-it).coerceAtLeast(0)}?:0;time=t;key=nextKey
        val cues=g.cues(staffs)
        val clear=staffs.take(c.staffCount).size==c.staffCount&&staffs.take(c.staffCount).all {it!=null&&!it.blurred&&!it.occluded&&it.confidence>=.55}&&cues.size==c.staffCount*2
        val good=clear&&cues.all {it.error.isFinite()&&it.error<=c.tolerance}
        val state=when {
            c.mode=="free"||!c.streakEffects->{ms=0;energy=0.0;previousGood=false;uncertainSince=null;if(c.mode=="free")"free"else"off"}
            !clear->{if(uncertainSince==null)uncertainSince=t;if(t-uncertainSince!!>350)ms=0;previousGood=false;"paused"}
            !good->{ms=0;previousGood=false;uncertainSince=null;"ready"}
            else->{if(uncertainSince?.let {t-it>350}==true)ms=0;uncertainSince=null;if(previousGood)ms+=dt;previousGood=true;"building"}
        }
        best=max(best,ms);val target=if(state=="building")min(1.0,ms/10000.0)else 0.0
        energy+=(target-energy)*(1-exp(-dt/350.0))
        return StreakFrame(state,ms/1000.0,best/1000.0,if(ms>=10000)4 else if(ms>=5000)3 else if(ms>=2000)2 else 1,energy,min(1.0,ms/10000.0))
    }
}
