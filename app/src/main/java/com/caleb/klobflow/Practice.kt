package com.caleb.klobflow

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

data class BeatHit(val time:Double,val offsetMs:Double,val error:Double,val point:Int) {
    fun json()=JSONObject().put("time",time).put("offsetMs",offsetMs).put("error",error).put("point",point)
}
data class BeatFrame(val enabled:Boolean=false,val bpm:Double=120.0,val phase:Double=0.0,val targets:List<List<P>> = emptyList(),val hits:List<BeatHit?> = emptyList()) {
    fun json()=JSONObject().put("enabled",enabled).put("bpm",bpm).put("phase",phase).put("targets",JSONArray(targets.map {list->JSONArray(list.map {it.json()})})).put("hits",JSONArray(hits.map {it?.json() ?: JSONObject.NULL}))
}
/** Measures crossings of fixed target rays. Timing and distance are separate observations. */
class TimingCoach {
    private var epoch:Double?=null
    private var previous:Pair<Long,List<Segment?>>?=null
    private var hits=mutableListOf<BeatHit?>(null,null)
    fun reset(time:Double?=null){epoch=time;previous=null;hits=mutableListOf(null,null)}
    fun targets(g:Guide,index:Int):List<P> {
        val c=g.config;val center=if(c.mode=="circles")g.circles[index]else g.center
        if(c.mode=="cube")return if(c.beatPoints==8)g.vertices else if(c.beatPoints==4)g.vertices.take(4)else listOf(g.vertices[0],g.vertices[2])
        return (0 until c.beatPoints).map {i->
            val a=-PI/2+i*2*PI/c.beatPoints+Math.toRadians(c.rotation)
            val d=P(cos(a),sin(a))
            val r=if(c.mode=="grid")g.radius/max(abs(cos(a-Math.toRadians(c.rotation))),abs(sin(a-Math.toRadians(c.rotation))))else g.radius
            center+d*r
        }
    }
    fun update(t:Long,staffs:List<Segment?>,g:Guide,tempo:Double=g.config.bpm):BeatFrame {
        if(!g.config.tempoEnabled){reset();return BeatFrame()}
        if(epoch==null)epoch=t.toDouble()
        val period=60000/tempo;val phase=(((t-epoch!!)/period)%1+1)%1
        val measured=staffs.take(g.config.staffCount).map {it?.takeIf {s->s.confidence>=.55 && !s.occluded}?.let(g::rectify)}
        val targets=(0 until g.config.staffCount).map {targets(g,it)}
        val prev=previous;val dt=if(prev==null)0L else t-prev.first
        measured.forEachIndexed {i,s->
            val old=prev?.second?.getOrNull(i)
            if(s==null || old==null || dt !in 1..150){hits[i]=null;return@forEachIndexed}
            val center=if(g.config.mode=="circles")g.circles[i]else g.center
            val a=old.a-center;val b=s.a-center
            val before=atan2(a.y,a.x);val delta=atan2(sin(atan2(b.y,b.x)-before),cos(atan2(b.y,b.x)-before))
            // Ignore stationary props, center crossings, and implausibly large endpoint jumps.
            if(a.distance(P(0.0,0.0))>g.radius*.2 && b.distance(P(0.0,0.0))>g.radius*.2 && abs(delta) in .001..1.2){
                targets[i].forEachIndexed {j,target->
                    val d=target-center;val to=atan2(sin(atan2(d.y,d.x)-before),cos(atan2(d.y,d.x)-before));val fraction=to/delta
                    if(fraction>0 && fraction<=1){
                        val at=prev!!.first+dt*fraction;val nearest=epoch!!+floor((at-epoch!!)/period+.5)*period
                        val p=old.a+(s.a-old.a)*fraction
                        hits[i]=BeatHit(at,at-nearest,p.distance(target)/(2*g.radius)*100,j+1)
                    }
                }
            }
            if(hits[i]!=null && t-hits[i]!!.time>period*2)hits[i]=null
        }
        previous=t to measured
        return BeatFrame(true,tempo,phase,targets.map {list->list.map(g::project)},hits.take(g.config.staffCount))
    }
}

/** Fits a full-rotation envelope, so a briefly horizontal staff cannot cause an unsafe tight crop. */
class FitHelper {
    var active=false;private set
    var allowZoom=false;private set
    var sizeOnly=false;private set
    var status="";private set
    private var start=0L
    private val samples=mutableListOf<List<Segment>>()
    fun begin(zoom:Boolean=false,size:Boolean=false){active=true;allowZoom=zoom;sizeOnly=size;start=0;samples.clear();status=if(size)"Hold each full staff visible to match the guide size." else "Fitting center and size: keep your full staves visible for two seconds."}
    fun cancel(){active=false;samples.clear();status=""}
    fun update(t:Long,staffs:List<Segment?>,g:Guide,zoomMin:Double,zoomMax:Double,zoom:Double):JSONObject? {
        if(!active)return null
        val measured=staffs.take(g.config.staffCount).map {it?.takeIf {s->s.confidence>=.7 && !s.occluded}?.let(g::rectify)}
        if(measured.size!=g.config.staffCount || measured.any {it==null}){start=0;samples.clear();status="Waiting for ${g.config.staffCount} fully visible staff${if(g.config.staffCount==2)"s"else""} to fit the guide.";return null}
        if(start==0L)start=t
        samples.add(measured.filterNotNull());if(samples.size>90)samples.removeAt(0)
        status="Fitting ${((t-start)/20).coerceAtMost(100)}% · keep the full movement in view"
        if(t-start<2000 || samples.size<12)return null
        val all=samples.flatten();val lengths=all.map {it.length}.sorted();val radius=lengths[lengths.size/2]/2
        val center=P(all.map {it.center.x}.average(),all.map {it.center.y}.average())
        val x=if(g.calibrated)max(1.0,g.config.planeAspect)else g.aspectX;val y=if(g.calibrated)max(1.0,1/g.config.planeAspect)else g.aspectY
        val spanX=all.maxOf {it.center.x+it.length/2}-all.minOf {it.center.x-it.length/2}
        val spanY=all.maxOf {it.center.y+it.length/2}-all.minOf {it.center.y-it.length/2}
        if(allowZoom && !g.calibrated && zoomMax>zoomMin){
            val extentX=all.maxOf {abs(it.center.x-x/2)+it.length/2};val extentY=all.maxOf {abs(it.center.y-y/2)+it.length/2}
            val desired=(zoom*min(1.5,min(x*.41/extentX,y*.41/extentY))).coerceIn(zoomMin,zoomMax)
            allowZoom=false
            if(abs(desired-zoom)>zoom*.08){start=0;samples.clear();status="Adjusting camera framing, then refitting the guide…";return JSONObject().put("zoom",desired)}
        }
        val scale=if(sizeOnly || g.config.mode in listOf("circles","free"))radius else max(spanX,spanY)/2/(if(g.config.mode=="cube")1+g.config.cubeDepth/2 else 1.0)
        val patch=JSONObject().put("scale",scale.coerceIn(.1,.48))
        if(!sizeOnly)patch.put("cx",(center.x/x).coerceIn(.1,.9)).put("cy",(center.y/y).coerceIn(.1,.9))
        if(!sizeOnly && g.config.mode=="circles" && g.config.staffCount==2){
            val a=P(samples.map {it[0].center.x}.average(),samples.map {it[0].center.y}.average());val b=P(samples.map {it[1].center.x}.average(),samples.map {it[1].center.y}.average())
            patch.put("circleSeparation",(a.distance(b)/radius).coerceIn(0.0,1.8))
        }
        active=false;samples.clear();status=if(scale>.48)"Guide reached its size limit. Step back or widen the camera, then fit again."else if(sizeOnly)"Guide diameter / width matches the visible staff length."else "Center and size fitted. Adjust Size for your intended pattern."
        return patch
    }
}
