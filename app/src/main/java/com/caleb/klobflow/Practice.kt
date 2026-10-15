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
    /** Cosmetic controls preserve the user's beat origin; new geometry only clears crossings. */
    fun reconfigure(before:Config,after:Config) {
        fun clock(c:Config)=listOf(c.tempoEnabled,c.bpm,c.tempoSource,c.audioRate,c.audioOffsetMs)
        fun geometry(c:Config)=listOf(c.mode,c.staffCount,c.beatPoints,c.cx,c.cy,c.scale,c.rotation,c.cubeDepth,c.circleSeparation,c.planeCorners,c.planeAspect,c.calibrationImageAspect,c.calibrationRotation,c.facing,c.fps,c.mirror,c.zoom,c.led,c.threshold,c.minLength,c.staffColors)
        if(clock(before)!=clock(after))reset()
        else if(geometry(before)!=geometry(after)){previous=null;hits=mutableListOf(null,null)}
    }
    fun targets(g:Guide,index:Int):List<P> {
        val c=g.config;val center=if(c.mode in listOf("circles","antispin"))g.circles[index]else g.center
        if(c.mode=="cube")return if(c.beatPoints==8)g.vertices else if(c.beatPoints==4)g.vertices.take(4)else listOf(g.vertices[0],g.vertices[2])
        val points=if(c.mode=="antispin")4 else c.beatPoints
        return (0 until points).map {i->
            val a=-PI/2+i*2*PI/points+Math.toRadians(c.rotation)
            val d=P(cos(a),sin(a))
            val r=if(c.mode=="grid")g.radius/max(abs(cos(a-Math.toRadians(c.rotation))),abs(sin(a-Math.toRadians(c.rotation))))else g.radius
            center+d*r
        }
    }
    fun update(t:Long,staffs:List<Segment?>,g:Guide,tempo:Double=g.config.bpm,externalEpoch:Double?=null,ready:Boolean=true):BeatFrame {
        if(!g.config.tempoEnabled || !ready){reset();return BeatFrame()}
        if(externalEpoch!=null)epoch=externalEpoch
        if(epoch==null)epoch=t.toDouble()
        val period=60000/tempo;val phase=(((t-epoch!!)/period)%1+1)%1
        val measured=staffs.take(g.config.staffCount).map {it?.takeIf {s->s.confidence>=.55 && !s.occluded && !s.blurred}?.let(g::rectify)}
        val targets=(0 until g.config.staffCount).map {targets(g,it)}
        val prev=previous;val dt=if(prev==null)0L else t-prev.first
        measured.forEachIndexed {i,s->
            val old=prev?.second?.getOrNull(i)
            if(s==null || old==null || dt !in 1..150){hits[i]=null;return@forEachIndexed}
            val center=if(g.config.mode in listOf("circles","antispin"))g.circles[i]else g.center
            val antispin=g.config.mode=="antispin"
            val oldTips=if(antispin)g.antispinTips(old,i)else listOf(old.a)
            val tips=if(antispin)g.antispinTips(s,i)else listOf(s.a)
            // A linear tip cannot cross angular rays. Together the horizontal x and vertical y
            // coordinates describe cycle phase; each cardinal phase is an outer turnaround.
            fun cycle(points:List<P>)=P(g.antispinLocal(points[0],i).x,g.antispinLocal(points[1],i).y)
            val a=if(antispin)cycle(oldTips)else old.a-center;val b=if(antispin)cycle(tips)else s.a-center
            val before=atan2(a.y,a.x);val delta=atan2(sin(atan2(b.y,b.x)-before),cos(atan2(b.y,b.x)-before))
            // Ignore stationary props, center crossings, and implausibly large endpoint jumps.
            if(a.distance(P(0.0,0.0))>g.radius*.2 && b.distance(P(0.0,0.0))>g.radius*.2 && abs(delta) in .001..1.2){
                targets[i].forEachIndexed {j,target->
                    val d=if(antispin)g.antispinLocal(target,i)else target-center;val to=atan2(sin(atan2(d.y,d.x)-before),cos(atan2(d.y,d.x)-before));val raw=to/delta;val epsilon=if(antispin)1e-9 else 0.0;val fraction=raw.coerceIn(0.0,1.0)
                    if(raw>epsilon && raw<=1+epsilon && (!antispin || hits[i]?.point!=j+1 || t-hits[i]!!.time>period*2)){
                        val at=prev!!.first+dt*fraction;val nearest=epoch!!+floor((at-epoch!!)/period+.5)*period
                        val tip=if(antispin && j%2==0)1 else 0
                        val p=oldTips[tip]+(tips[tip]-oldTips[tip])*fraction
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
    private var start:Long?=null;private var lastSample:Long?=null
    private val samples=mutableListOf<List<Segment>>()
    fun begin(zoom:Boolean=false,size:Boolean=false){active=true;allowZoom=zoom;sizeOnly=size;start=null;lastSample=null;samples.clear();status=if(size)"Hold each full staff visible to match the guide size." else "Fitting center and size: keep your full staves visible for two seconds."}
    fun cancel(){active=false;start=null;lastSample=null;samples.clear();status=""}
    fun update(t:Long,staffs:List<Segment?>,g:Guide,zoomMin:Double,zoomMax:Double,zoom:Double):JSONObject? {
        if(!active)return null
        val measured=staffs.take(g.config.staffCount).map {it?.takeIf {s->s.confidence>=.7 && !s.occluded && !s.blurred}?.let(g::rectify)}
        if(measured.size!=g.config.staffCount || measured.any {it==null}){start=null;lastSample=null;samples.clear();status="Waiting for ${g.config.staffCount} fully visible staff${if(g.config.staffCount==2)"s"else""} to fit the guide.";return null}
        // Keep the full collection interval at every frame rate, and never count an unseen gap.
        if(lastSample?.let {t<it || t-it>250}==true){start=null;samples.clear()}
        if(lastSample==t)return null
        if(start==null)start=t
        lastSample=t;samples.add(measured.filterNotNull())
        val elapsed=t-start!!
        status="Fitting ${(elapsed/20).coerceAtMost(100)}% · keep the full movement in view"
        if(elapsed<2000 || samples.size<12)return null
        val all=samples.flatten();val lengths=all.map {it.length}.sorted();val radius=lengths[lengths.size/2]/2
        val crossCenters=if(g.config.mode=="antispin")(0 until g.config.staffCount).map {i->
            val endpoints=samples.flatMap {listOf(it[i].a,it[i].b)}.map(g::local)
            g.point((endpoints.minOf {it.x}+endpoints.maxOf {it.x})/(2*g.radius),(endpoints.minOf {it.y}+endpoints.maxOf {it.y})/(2*g.radius))
        }else emptyList()
        val center=if(crossCenters.isNotEmpty())P(crossCenters.map {it.x}.average(),crossCenters.map {it.y}.average())else P(all.map {it.center.x}.average(),all.map {it.center.y}.average())
        val x=if(g.calibrated)max(1.0,g.config.planeAspect)else g.aspectX;val y=if(g.calibrated)max(1.0,1/g.config.planeAspect)else g.aspectY
        val spanX=all.maxOf {it.center.x+it.length/2}-all.minOf {it.center.x-it.length/2}
        val spanY=all.maxOf {it.center.y+it.length/2}-all.minOf {it.center.y-it.length/2}
        if(allowZoom && !g.calibrated && zoomMax>zoomMin){
            val extentX=all.maxOf {abs(it.center.x-x/2)+it.length/2};val extentY=all.maxOf {abs(it.center.y-y/2)+it.length/2}
            val desired=(zoom*min(1.5,min(x*.41/extentX,y*.41/extentY))).coerceIn(zoomMin,zoomMax)
            allowZoom=false
            if(abs(desired-zoom)>zoom*.08){start=null;lastSample=null;samples.clear();status="Adjusting camera framing, then refitting the guide…";return JSONObject().put("zoom",desired)}
        }
        val scale=if(g.config.mode=="antispin")radius*2 else if(sizeOnly || g.config.mode in listOf("circles","free"))radius else max(spanX,spanY)/2/(if(g.config.mode=="cube")1+g.config.cubeDepth/2 else 1.0)
        val patch=JSONObject().put("scale",scale.coerceIn(.1,.48))
        if(!sizeOnly)patch.put("cx",(center.x/x).coerceIn(.1,.9)).put("cy",(center.y/y).coerceIn(.1,.9))
        if(!sizeOnly && g.config.mode=="circles" && g.config.staffCount==2){
            val a=P(samples.map {it[0].center.x}.average(),samples.map {it[0].center.y}.average());val b=P(samples.map {it[1].center.x}.average(),samples.map {it[1].center.y}.average())
            patch.put("circleSeparation",(a.distance(b)/radius).coerceIn(0.0,1.8))
        }
        if(!sizeOnly && crossCenters.size==2)patch.put("circleSeparation",(abs(g.local(crossCenters[1]).x-g.local(crossCenters[0]).x)/patch.getDouble("scale")).coerceIn(0.0,1.8))
        active=false;samples.clear();status=if(scale>.48)"Guide reached its size limit. Step back or widen the camera, then fit again."else if(g.config.mode=="antispin")"Cross center to each outer end matches one staff length. Check the center after a full cycle."else if(sizeOnly)"Guide diameter / width matches the visible staff length."else "Center and size fitted. Adjust Size for your intended pattern."
        return patch
    }
}
