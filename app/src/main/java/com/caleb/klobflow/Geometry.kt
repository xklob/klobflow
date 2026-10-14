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
data class Segment(val a: P, val b: P, val confidence: Double = 1.0) {
    val center get() = (a+b)*0.5
    val length get() = a.distance(b)
    val angle get() = atan2(b.y-a.y,b.x-a.x)
    fun reversed() = copy(a=b,b=a)
    fun json() = JSONObject().put("a",a.json()).put("b",b.json()).put("confidence",confidence)
}
fun angleDifference(a: Double,b: Double): Double = abs(atan2(sin(2*(a-b)),cos(2*(a-b))))/2
fun distanceToSegment(p: P,s: Segment): Double {
    val d=s.b-s.a
    val t=(((p.x-s.a.x)*d.x+(p.y-s.a.y)*d.y)/(d.x*d.x+d.y*d.y).coerceAtLeast(1e-12)).coerceIn(0.0,1.0)
    return p.distance(s.a+d*t)
}

data class Config(
    val mode: String="grid", val led: Boolean=true, val threshold: Int=175,
    val minLength: Double=0.22, val cx: Double=0.5, val cy: Double=0.5,
    val scale: Double=0.32, val rotation: Double=0.0, val cubeDepth: Double=0.4,
    val circleSeparation: Double=1.0, val tolerance: Double=4.0,
    val diagonals: Boolean=true, val trails: Boolean=true, val showGuide: Boolean=true,
    val symmetry: Boolean=true, val facing: String="front", val fps: Int=60,
    val timing: String="tog-same", val ratio: String="1:1"
) {
    fun json() = JSONObject().apply {
        put("mode",mode);put("led",led);put("threshold",threshold);put("minLength",minLength)
        put("cx",cx);put("cy",cy);put("scale",scale);put("rotation",rotation);put("cubeDepth",cubeDepth)
        put("circleSeparation",circleSeparation);put("tolerance",tolerance);put("diagonals",diagonals)
        put("trails",trails);put("showGuide",showGuide);put("symmetry",symmetry)
        put("facing",facing);put("fps",fps);put("timing",timing);put("ratio",ratio)
    }
    fun patch(j: JSONObject): Config {
        fun num(k: String,v: Double,lo: Double,hi: Double): Double {
            val n=if(j.has(k)) j.getDouble(k) else v
            require(n.isFinite() && n in lo..hi) { "$k must be between $lo and $hi" };return n
        }
        fun choice(k: String,v: String,allowed: List<String>) = (if(j.has(k)) j.getString(k) else v).also { require(it in allowed) { "Invalid $k" } }
        fun flag(k: String,v: Boolean) = if(j.has(k)) j.getBoolean(k) else v
        return copy(mode=choice("mode",mode,listOf("grid","circles","cube","free")),led=flag("led",led),
            threshold=num("threshold",threshold.toDouble(),60.0,250.0).toInt(),minLength=num("minLength",minLength,0.1,0.8),
            cx=num("cx",cx,0.1,0.9),cy=num("cy",cy,0.1,0.9),scale=num("scale",scale,0.1,0.48),
            rotation=num("rotation",rotation,-90.0,90.0),cubeDepth=num("cubeDepth",cubeDepth,0.1,0.9),
            circleSeparation=num("circleSeparation",circleSeparation,0.0,1.8),tolerance=num("tolerance",tolerance,1.0,15.0),
            diagonals=flag("diagonals",diagonals),trails=flag("trails",trails),showGuide=flag("showGuide",showGuide),symmetry=flag("symmetry",symmetry),
            facing=choice("facing",facing,listOf("front","back")),fps=num("fps",fps.toDouble(),30.0,60.0).toInt().also {require(it==30 || it==60)},
            timing=choice("timing",timing,listOf("tog-same","split-same","tog-opp","split-opp")),ratio=choice("ratio",ratio,listOf("1:1","1:3","1:5")))
    }
}

/** Isotropic image coordinates: one unit is the shorter image dimension. */
class Guide(val config: Config,val width: Int,val height: Int) {
    private val short=min(width,height).toDouble()
    val aspectX=width/short;val aspectY=height/short
    val center=P(config.cx*aspectX,config.cy*aspectY)
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
    val circles get()=listOf(point(-config.circleSeparation/2,0.0),point(config.circleSeparation/2,0.0))
    fun deviation(p: P): Double = when(config.mode) {
        "circles" -> circles.minOf { abs(p.distance(it)-radius) }
        "cube" -> vertices.minOf { p.distance(it) }
        "grid" -> lines.minOf { distanceToSegment(p,it) }
        else -> 0.0
    }
    fun json()=JSONObject().put("lines",JSONArray(lines.map { it.json() }))
        .put("vertices",JSONArray(if(config.mode in listOf("grid","cube")) vertices.map { it.json() } else emptyList<Any>()))
        .put("circles",JSONArray(if(config.mode=="circles") circles.map { JSONObject().put("center",it.json()).put("radius",radius) } else emptyList<Any>()))
        .put("center",center.json()).put("span",2*radius).put("aspectX",aspectX).put("aspectY",aspectY)
}

data class Metrics(val deviation: Double?=null,val angle: Double?=null,val symmetry: Double?=null,val steadiness: Double?=null,val coverage: Double=0.0) {
    fun json()=JSONObject().put("deviation",deviation ?: JSONObject.NULL).put("angle",angle ?: JSONObject.NULL)
        .put("symmetry",symmetry ?: JSONObject.NULL).put("steadiness",steadiness ?: JSONObject.NULL).put("coverage",coverage)
}
class Scorer {
    private val history=ArrayDeque<Pair<Long,List<Segment?>>>()
    fun reset(){history.clear()}
    fun score(t: Long,staffs: List<Segment?>,g: Guide): Metrics {
        history.addLast(t to staffs)
        while(history.isNotEmpty() && t-history.first().first>1200)history.removeFirst()
        val good=staffs.filterNotNull().filter {it.confidence>=0.55}
        val coverage=history.count {it.second.count {s->s!=null && s.confidence>=0.55}==2}.toDouble()/history.size*100
        if(good.size!=2)return Metrics(coverage=coverage)
        val pts=good.flatMap {listOf(it.a,it.b)}
        val deviation=if(g.config.mode=="free")null else sqrt(pts.sumOf {g.deviation(it).pow(2)}/4)/(2*g.radius)*100
        val angles=g.lines.map {it.angle}
        val angle=if(angles.isEmpty())null else good.map {s->angles.minOf {Math.toDegrees(angleDifference(s.angle,it))}}.average()
        val localAngle=Math.toRadians(g.config.rotation)
        fun reflect(p:P):P {
            val d=p-g.center;val x=d.x*cos(localAngle)+d.y*sin(localAngle);val y=-d.x*sin(localAngle)+d.y*cos(localAngle)
            return g.center+P(-x*cos(localAngle)-y*sin(localAngle),-x*sin(localAngle)+y*cos(localAngle))
        }
        val a=good[0];val b=good[1]
        val sym=if(g.config.symmetry) sqrt(min(reflect(a.a).distance(b.a).pow(2)+reflect(a.b).distance(b.b).pow(2),reflect(a.a).distance(b.b).pow(2)+reflect(a.b).distance(b.a).pow(2))/2)/(2*g.radius)*100 else null
        val speeds=history.zipWithNext().mapNotNull {(prev,next)->
            val dt=(next.first-prev.first)/1000.0
            if(dt<=0 || dt>0.15 || prev.second.any {it==null || it.confidence<0.55} || next.second.any {it==null || it.confidence<0.55})null
            else (0..1).map {angleDifference(next.second[it]!!.angle,prev.second[it]!!.angle)/dt}.average()
        }
        val mean=if(speeds.isEmpty())0.0 else speeds.average()
        val steadiness=if(speeds.size>=12 && mean>0.15 && coverage>=90) sqrt(speeds.sumOf {(it-mean).pow(2)}/speeds.size)/mean*100 else null
        return Metrics(deviation,angle,sym,steadiness,coverage)
    }
}
