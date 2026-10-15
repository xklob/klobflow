package com.caleb.klobflow

import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

data class PacerFrame(
    val enabled:Boolean=false,val state:String="off",val phase:Double=0.0,val elapsedSeconds:Double=0.0,
    val countdownMs:Long=0,val rpm:Double=20.0,val targets:List<List<P>> = emptyList(),val feedback:List<TipCue> = emptyList(),
    val valid:Boolean=false,val onTarget:Boolean=false,val meanError:Double?=null,val onTargetPercent:Double?=null,val measuredPercent:Double?=null
) {
    fun json()=JSONObject().put("enabled",enabled).put("state",state).put("phase",phase).put("elapsedSeconds",elapsedSeconds)
        .put("countdownMs",countdownMs).put("rpm",rpm).put("targets",JSONArray(targets.map {pair->JSONArray(pair.map {it.json()})}))
        .put("feedback",JSONArray(feedback.map {it.json()})).put("valid",valid).put("onTarget",onTarget)
        .put("meanError",meanError ?: JSONObject.NULL).put("onTargetPercent",onTargetPercent ?: JSONObject.NULL).put("measuredPercent",measuredPercent ?: JSONObject.NULL)
}

/** Runtime-only pacing. Targets keep moving through misses; only current measured tips score. */
class MovingPacer {
    private data class Sample(val time:Long,val valid:Boolean,val onTarget:Boolean,val error:Double?)
    private var key:String?=null
    private var time:Long?=null
    private var state="off"
    private var elapsedMs=0L
    private var countdownMs=0L
    private val history=ArrayDeque<Sample>()
    private var sampleTime:Long?=null

    private fun configKey(c:Config)=listOf(c.mode,c.staffCount,c.pacerEnabled,c.pacerRpm,c.pacerDirection,c.pacerPattern,c.pacerOffset,c.pacerCountdown,
        c.cx,c.cy,c.scale,c.rotation,c.circleSeparation,c.tolerance,c.planeCorners,c.planeAspect,c.calibrationRotation,c.calibrationImageAspect,
        c.facing,c.mirror,c.zoom,c.led,c.threshold,c.minLength,c.staffColors,c.fps).toString()
    private fun enabled(g:Guide)=g.config.pacerEnabled && g.config.mode in listOf("circles","antispin")
    private fun clear(s:Segment?)=s!=null && s.confidence.isFinite() && s.confidence>=.55 && !s.blurred && !s.occluded &&
        s.a.x.isFinite() && s.a.y.isFinite() && s.b.x.isFinite() && s.b.y.isFinite()
    private fun squared(a:P,b:P)=(a.x-b.x).pow(2)+(a.y-b.y).pow(2)
    private fun clearStatistics(){history.clear();sampleTime=null}
    fun reset(){key=null;time=null;state="off";elapsedMs=0;countdownMs=0;clearStatistics()}
    fun reconfigure(before:Config,after:Config){if(configKey(before)!=configKey(after))reset()}
    private fun ready(g:Guide){state=if(enabled(g))"ready"else"off";elapsedMs=0;countdownMs=0;clearStatistics()}
    private fun synchronize(t:Long,g:Guide) {
        val nextKey=configKey(g.config)+":${g.width}:${g.height}"
        if(key!=nextKey){reset();key=nextKey;ready(g)}
        val previous=time;time=t
        if(previous!=null && (t<previous || t-previous>750)){ready(g);return}
        var remaining=if(previous==null)0 else t-previous
        if(state=="countdown") {
            val used=min(remaining,countdownMs);countdownMs-=used;remaining-=used
            if(countdownMs==0L)state="running"
        }
        if(state=="running")elapsedMs+=remaining
    }
    fun command(operation:String,time:Long,guide:Guide) {
        val t=time;val g=guide
        require(operation in listOf("start","pause","resume","restart","stop")){"Unknown moving-dot operation"}
        synchronize(t,g)
        when(operation) {
            "start","restart"->{
                require(enabled(g)){"Enable moving dots in Circles or Antispin before starting"}
                elapsedMs=0;countdownMs=g.config.pacerCountdown*1000L;state=if(countdownMs>0)"countdown"else"running";clearStatistics()
            }
            "pause"->{if(state in listOf("running","countdown"))state="paused";countdownMs=0;clearStatistics()}
            "resume"->if(state=="paused"){countdownMs=g.config.pacerCountdown*1000L;state=if(countdownMs>0)"countdown"else"running";clearStatistics()}
            "stop"->ready(g)
        }
    }
    fun update(time:Long,staffs:List<Segment?>,guide:Guide):PacerFrame {
        val t=time;val g=guide
        synchronize(t,g)
        val c=g.config;val active=enabled(g);val phase=(elapsedMs*c.pacerRpm/60000)%1.0
        val frame=PacerFrame(enabled=active,state=state,phase=phase,elapsedSeconds=elapsedMs/1000.0,countdownMs=countdownMs,rpm=c.pacerRpm)
        if(!active)return frame
        val sign=if(c.pacerDirection=="cw")1 else -1;val theta=sign*2*PI*phase
        val count=if(c.mode=="antispin")1 else c.staffCount
        val planeTargets=if(c.mode=="antispin")listOf(listOf(g.point(cos(theta),0.0),g.point(0.0,sin(theta))))
            else g.circles.take(count).mapIndexed {i,center->
                val angle=theta*(if(i==1 && c.pacerPattern=="opposite")-1 else 1)+Math.toRadians(c.rotation+(if(i==1)c.pacerOffset else 0.0))
                val delta=P(cos(angle),sin(angle))*g.radius;listOf(center+delta,center-delta)
            }
        val targets=planeTargets.map {pair->pair.map(g::project)}
        if(state!="running")return frame.copy(targets=targets)
        val selected=staffs.take(count)
        val measured=if(selected.size==count && selected.all(::clear))selected.map {g.rectify(it!!)} else emptyList()
        val valid=measured.size==count && measured.all(::clear)
        val feedback=if(valid)measured.flatMapIndexed {i,segment->
            val s=segment!!;val pair=planeTargets[i]
            val swap=squared(s.a,pair[1])+squared(s.b,pair[0])<squared(s.a,pair[0])+squared(s.b,pair[1])
            listOf(s.a,s.b).mapIndexed {j,point->
                val targetIndex=if(swap)1-j else j;val error=point.distance(pair[targetIndex])/(2*g.radius)*100
                TipCue(if(j==0)selected[i]!!.a else selected[i]!!.b,targets[i][targetIndex],error,error<=c.tolerance,
                    if(c.mode!="antispin")null else if(targetIndex==0)"horizontal"else"vertical")
            }
        }else emptyList()
        val onTarget=valid && feedback.all {it.onTarget}
        if(sampleTime!=t){history.addLast(Sample(t,valid,onTarget,if(valid)feedback.map {it.error}.average()else null));sampleTime=t}
        while(history.isNotEmpty() && t-history.first().time>5000)history.removeFirst()
        val measuredHistory=history.filter {it.valid}
        return frame.copy(targets=targets,feedback=feedback,valid=valid,onTarget=onTarget,
            measuredPercent=if(history.isEmpty())null else measuredHistory.size.toDouble()/history.size*100,
            meanError=if(measuredHistory.isEmpty())null else measuredHistory.map {it.error!!}.average(),
            onTargetPercent=if(measuredHistory.isEmpty())null else measuredHistory.count {it.onTarget}.toDouble()/measuredHistory.size*100)
    }
}
