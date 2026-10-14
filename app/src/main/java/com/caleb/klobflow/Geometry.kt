package com.caleb.klobflow

import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

data class P(val x: Double, val y: Double) {
    operator fun plus(o: P) = P(x+o.x,y+o.y)
    operator fun minus(o: P) = P(x-o.x,y-o.y)
    operator fun times(s: Double) = P(x*s,y*s)
    fun distance(o: P) = hypot(x-o.x,y-o.y)
    fun json() = JSONArray(listOf(x,y))
}
data class Segment(val a: P, val b: P, val confidence: Double = 1.0, val occluded: Boolean = false, val blurred:Boolean=false) {
    val center get() = (a+b)*0.5
    val length get() = a.distance(b)
    val angle get() = atan2(b.y-a.y,b.x-a.x)
    fun reversed() = copy(a=b,b=a)
    fun json() = JSONObject().put("a",a.json()).put("b",b.json()).put("confidence",confidence).put("occluded",occluded).put("blurred",blurred)
}
fun angleDifference(a: Double,b: Double): Double = abs(atan2(sin(2*(a-b)),cos(2*(a-b))))/2
fun nearestOnSegment(p: P,s: Segment): P {
    val d=s.b-s.a
    val t=(((p.x-s.a.x)*d.x+(p.y-s.a.y)*d.y)/(d.x*d.x+d.y*d.y).coerceAtLeast(1e-12)).coerceIn(0.0,1.0)
    return s.a+d*t
}

fun distanceToSegment(p:P,s:Segment):Double=p.distance(nearestOnSegment(p,s))
data class TipCue(val tip:P,val target:P,val error:Double,val onTarget:Boolean) {
    fun json()=JSONObject().put("tip",tip.json()).put("target",target.json()).put("error",error).put("onTarget",onTarget)
}

data class Config(
    val mode: String="grid", val led: Boolean=true, val threshold: Int=175,
    val minLength: Double=0.22, val cx: Double=0.5, val cy: Double=0.5,
    val scale: Double=0.32, val rotation: Double=0.0, val cubeDepth: Double=0.4,
    val circleSeparation: Double=1.0, val tolerance: Double=4.0,
    val diagonals: Boolean=true, val trails: Boolean=true, val showGuide: Boolean=true,
    val showFeedback: Boolean=true, val symmetry: Boolean=true, val facing: String="front", val fps: Int=60,
    val timing: String="tog-same", val ratio: String="1:1", val zoom: Double=0.0, val mirror: Boolean=true,
    val planeCorners: List<P> = emptyList(), val planeAspect: Double=1.0,
    val calibrationRotation: Int=0, val calibrationImageAspect: Double=0.0,
    val staffCount:Int=2, val autoFit:Boolean=true, val tempoEnabled:Boolean=false, val bpm:Double=120.0, val beatPoints:Int=4, val tempoSource:String="manual", val audioRate:Double=1.0, val audioOffsetMs:Double=0.0
) {
    fun json() = JSONObject().apply {
        put("tempoSource",tempoSource);put("audioRate",audioRate);put("audioOffsetMs",audioOffsetMs)
        put("staffCount",staffCount);put("autoFit",autoFit);put("tempoEnabled",tempoEnabled);put("bpm",bpm);put("beatPoints",beatPoints)
        put("mode",mode);put("led",led);put("threshold",threshold);put("minLength",minLength)
        put("cx",cx);put("cy",cy);put("scale",scale);put("rotation",rotation);put("cubeDepth",cubeDepth)
        put("circleSeparation",circleSeparation);put("tolerance",tolerance);put("diagonals",diagonals)
        put("trails",trails);put("showGuide",showGuide);put("symmetry",symmetry);put("showFeedback",showFeedback)
        put("facing",facing);put("fps",fps);put("timing",timing);put("ratio",ratio);put("zoom",zoom);put("mirror",mirror)
        put("planeCorners",JSONArray(planeCorners.map {it.json()}));put("planeAspect",planeAspect)
        put("calibrationRotation",calibrationRotation);put("calibrationImageAspect",calibrationImageAspect)
    }
    fun patch(j: JSONObject,restore:Boolean=false): Config {
        fun num(k: String,v: Double,lo: Double,hi: Double): Double {
            val n=if(j.has(k)) j.getDouble(k) else v
            require(n.isFinite() && n in lo..hi) { "$k must be between $lo and $hi" };return n
        }
        fun choice(k: String,v: String,allowed: List<String>) = (if(j.has(k)) j.getString(k) else v).also { require(it in allowed) { "Invalid $k" } }
        fun flag(k: String,v: Boolean) = if(j.has(k)) j.getBoolean(k) else v
        val nextFacing=choice("facing",facing,listOf("front","back"))
        val nextZoom=num("zoom",zoom,0.0,100.0)
        val nextMirror=flag("mirror",mirror)
        val corners=if(!restore && (nextFacing!=facing || nextZoom!=zoom || nextMirror!=mirror))emptyList() else if(j.has("planeCorners")) {
            val a=j.getJSONArray("planeCorners")
            require(a.length()==0 || a.length()==4){"Choose four calibration corners"}
            (0 until a.length()).map {val p=a.getJSONArray(it);require(p.length()==2);P(p.getDouble(0),p.getDouble(1))}
        } else planeCorners
        validateCorners(corners)
        return copy(tempoSource=choice("tempoSource",tempoSource,listOf("manual","phone","pc")),audioRate=num("audioRate",audioRate,.5,2.0).also {require(it in listOf(.5,1.0,2.0))},audioOffsetMs=num("audioOffsetMs",audioOffsetMs,-500.0,500.0),staffCount=num("staffCount",staffCount.toDouble(),1.0,2.0).also {require(it==1.0 || it==2.0)}.toInt(),autoFit=flag("autoFit",autoFit),tempoEnabled=flag("tempoEnabled",tempoEnabled),bpm=num("bpm",bpm,30.0,240.0),beatPoints=num("beatPoints",beatPoints.toDouble(),2.0,8.0).also {require(it in listOf(2.0,4.0,8.0))}.toInt(),mode=choice("mode",mode,listOf("grid","circles","cube","free")),led=flag("led",led),
            threshold=num("threshold",threshold.toDouble(),60.0,250.0).toInt(),minLength=num("minLength",minLength,0.1,0.8),
            cx=num("cx",cx,0.1,0.9),cy=num("cy",cy,0.1,0.9),scale=num("scale",scale,0.1,0.48),
            rotation=num("rotation",rotation,-90.0,90.0),cubeDepth=num("cubeDepth",cubeDepth,0.1,0.9),
            circleSeparation=num("circleSeparation",circleSeparation,0.0,1.8),tolerance=num("tolerance",tolerance,1.0,15.0),
            diagonals=flag("diagonals",diagonals),trails=flag("trails",trails),showGuide=flag("showGuide",showGuide),symmetry=flag("symmetry",symmetry),showFeedback=flag("showFeedback",showFeedback),
            facing=nextFacing,mirror=nextMirror,zoom=if(!restore && nextFacing!=facing)0.0 else nextZoom,planeCorners=corners,
            planeAspect=num("planeAspect",planeAspect,0.25,4.0),calibrationRotation=num("calibrationRotation",calibrationRotation.toDouble(),0.0,3.0).toInt(),
            calibrationImageAspect=num("calibrationImageAspect",calibrationImageAspect,0.0,4.0),fps=num("fps",fps.toDouble(),30.0,60.0).toInt().also {require(it==30 || it==60)},
            timing=choice("timing",timing,listOf("tog-same","split-same","tog-opp","split-opp")),ratio=choice("ratio",ratio,listOf("1:1","1:3","1:5")))
    }
}

/** Isotropic image coordinates: one unit is the shorter image dimension. */
class Guide(val config: Config,val width: Int,val height: Int) {
    private val short=min(width,height).toDouble()
    val aspectX=width/short;val aspectY=height/short
    val calibrated=config.planeCorners.isNotEmpty()
    private val planeX=if(calibrated)max(1.0,config.planeAspect) else aspectX
    private val planeY=if(calibrated)max(1.0,1/config.planeAspect) else aspectY
    private val plane=listOf(P(0.0,0.0),P(planeX,0.0),P(planeX,planeY),P(0.0,planeY))
    private val image=config.planeCorners.map {P(it.x*aspectX,it.y*aspectY)}
    private val projection=if(calibrated)Homography.between(plane,image) else null
    private val inverse=if(calibrated)Homography.between(image,plane) else null
    val center=P(config.cx*planeX,config.cy*planeY)
    fun project(p:P):P=projection?.map(p) ?: p
    fun rectify(s:Segment):Segment? {
        if(!calibrated)return s
        // Do not extrapolate scores outside the calibrated area or across a changed camera crop.
        if(abs(width.toDouble()/height-config.calibrationImageAspect)>0.03)return null
        fun unproject(p:P)=inverse?.map(p)?.takeIf {it.x in -1e-6..planeX+1e-6 && it.y in -1e-6..planeY+1e-6}
        return s.copy(a=unproject(s.a) ?: return null,b=unproject(s.b) ?: return null)
    }
    val radius=config.scale
    fun point(x: Double,y: Double): P {
        val r=Math.toRadians(config.rotation)
        return center+P(x*cos(r)-y*sin(r),x*sin(r)+y*cos(r))*radius
    }
    val vertices: List<P> get() = if(config.mode=="cube") {
        val d=config.cubeDepth
        listOf(-0.5,0.5).flatMap { z -> listOf(P(-1.0,-1.0),P(1.0,-1.0),P(1.0,1.0),P(-1.0,1.0)).map { point(it.x+z*d,it.y-z*d) } }
    } else (-1..1).flatMap { x -> (-1..1).map { y -> point(x.toDouble(),y.toDouble()) } }
    val lines: List<Segment> get() = when(config.mode) {
        "grid" -> (-1..1).flatMap { i -> listOf(Segment(point(i.toDouble(),-1.0),point(i.toDouble(),1.0)),Segment(point(-1.0,i.toDouble()),point(1.0,i.toDouble()))) } +
            if(config.diagonals) listOf(Segment(point(-1.0,-1.0),point(1.0,1.0)),Segment(point(-1.0,1.0),point(1.0,-1.0))) else emptyList()
        "cube" -> vertices.let { v -> (0..1).flatMap { z -> (0..3).map { i -> Segment(v[z*4+i],v[z*4+(i+1)%4]) } }+(0..3).map { i -> Segment(v[i],v[i+4]) } }
        else -> emptyList()
    }
    val circles get()=if(config.staffCount==1)listOf(center)else listOf(point(-config.circleSeparation/2,0.0),point(config.circleSeparation/2,0.0))
    fun deviation(p: P): Double = when(config.mode) {
        "circles" -> circles.minOf { abs(p.distance(it)-radius) }
        "cube" -> vertices.minOf { p.distance(it) }
        "grid" -> lines.minOf { distanceToSegment(p,it) }
        else -> 0.0
    }
    fun cues(staffs:List<Segment?>):List<TipCue> {
        if(config.mode=="free" || staffs.take(config.staffCount).size!=config.staffCount || staffs.take(config.staffCount).any {it==null || it.confidence<0.55})return emptyList()
        val measured=staffs.take(config.staffCount).map {rectify(it!!) ?: return emptyList()}
        fun target(p:P):P=when(config.mode){
            "grid"->lines.map {nearestOnSegment(p,it)}.minBy {it.distance(p)}
            "cube"->vertices.minBy {it.distance(p)}
            else->circles.map {c->val d=p-c;c+(if(d.distance(P(0.0,0.0))<1e-9)P(1.0,0.0) else d*(1/d.distance(P(0.0,0.0))))*radius}.minBy {it.distance(p)}
        }
        return measured.flatMapIndexed {i,s->listOf(s.a,s.b).mapIndexed {j,p->
            val dest=target(p);val error=p.distance(dest)/(2*radius)*100
            TipCue(if(j==0)staffs[i]!!.a else staffs[i]!!.b,project(dest),error,error<=config.tolerance)
        }}
    }
    val displayLines get()=lines.map {it.copy(a=project(it.a),b=project(it.b))}
    val displayVertices get()=vertices.map {project(it)}
    val circlePaths get()=if(config.mode=="circles")circles.map {c->(0..96).map {i->val a=i*2*PI/96;project(c+P(cos(a),sin(a))*radius)}} else emptyList()
    fun json()=JSONObject().put("lines",JSONArray(displayLines.map { it.json() }))
        .put("vertices",JSONArray(if(config.mode in listOf("grid","cube")) displayVertices.map { it.json() } else emptyList<Any>()))
        .put("circles",JSONArray()).put("paths",JSONArray(circlePaths.map {path->JSONArray(path.map {it.json()})}))
        .put("calibrated",calibrated)
        .put("center",project(center).json()).put("span",2*radius).put("aspectX",aspectX).put("aspectY",aspectY)
}

data class Metrics(val deviation: Double?=null,val angle: Double?=null,val symmetry: Double?=null,val steadiness: Double?=null,val coverage: Double=0.0) {
    fun json()=JSONObject().put("deviation",deviation ?: JSONObject.NULL).put("angle",angle ?: JSONObject.NULL)
        .put("symmetry",symmetry ?: JSONObject.NULL).put("steadiness",steadiness ?: JSONObject.NULL).put("coverage",coverage)
}
class Scorer {
    private val history=ArrayDeque<Pair<Long,List<Segment?>>>()
    fun reset(){history.clear()}
    fun score(t: Long,staffs: List<Segment?>,g: Guide): Metrics {
        val measured=staffs.take(g.config.staffCount).map {it?.let(g::rectify)}
        history.addLast(t to measured)
        while(history.isNotEmpty() && t-history.first().first>1200)history.removeFirst()
        val good=measured.filterNotNull().filter {it.confidence>=0.55}
        val coverage=history.count {it.second.count {s->s!=null && s.confidence>=0.55}==g.config.staffCount}.toDouble()/history.size*100
        if(good.size!=g.config.staffCount)return Metrics(coverage=coverage)
        val pts=good.flatMap {listOf(it.a,it.b)}
        val deviation=if(g.config.mode=="free")null else sqrt(pts.sumOf {g.deviation(it).pow(2)}/(2*g.config.staffCount))/(2*g.radius)*100
        val angles=g.lines.map {it.angle}
        val angle=if(angles.isEmpty())null else good.map {s->angles.minOf {Math.toDegrees(angleDifference(s.angle,it))}}.average()
        val localAngle=Math.toRadians(g.config.rotation)
        fun reflect(p:P):P {
            val d=p-g.center;val x=d.x*cos(localAngle)+d.y*sin(localAngle);val y=-d.x*sin(localAngle)+d.y*cos(localAngle)
            return g.center+P(-x*cos(localAngle)-y*sin(localAngle),-x*sin(localAngle)+y*cos(localAngle))
        }
        val a=good[0];val b=good.last()
        val sym=if(g.config.symmetry && g.config.staffCount==2) sqrt(min(reflect(a.a).distance(b.a).pow(2)+reflect(a.b).distance(b.b).pow(2),reflect(a.a).distance(b.b).pow(2)+reflect(a.b).distance(b.a).pow(2))/2)/(2*g.radius)*100 else null
        val speeds=history.zipWithNext().mapNotNull {(prev,next)->
            val dt=(next.first-prev.first)/1000.0
            if(dt<=0 || dt>0.15 || prev.second.any {it==null || it.confidence<0.55} || next.second.any {it==null || it.confidence<0.55})null
            else (0 until g.config.staffCount).map {angleDifference(next.second[it]!!.angle,prev.second[it]!!.angle)/dt}.average()
        }
        val mean=if(speeds.isEmpty())0.0 else speeds.average()
        val steadiness=if(speeds.size>=12 && mean>0.15 && coverage>=90) sqrt(speeds.sumOf {(it-mean).pow(2)}/speeds.size)/mean*100 else null
        return Metrics(deviation,angle,sym,steadiness,coverage)
    }
}
