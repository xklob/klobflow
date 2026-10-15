package com.caleb.klobflow

import org.json.JSONObject
import kotlin.math.*

private const val X_HOLD=5000L
private const val X_COUNTDOWN=5000L
private const val X_STILL=2000L
private const val X_GAP=250L
private fun clearStaff(s:Segment?)=s!=null && s.confidence>=.7 && !s.blurred && !s.occluded && listOf(s.a.x,s.a.y,s.b.x,s.b.y).all {it.isFinite()}
private fun stablePose(s:Segment,a:Segment)=s.center.distance(a.center)<=max(.012,a.length*.035) && abs(s.length-a.length)<=a.length*.08 && angleDifference(s.angle,a.angle)<=.10
private fun orderedPose(s:Segment,a:Segment)=if(s.a.distance(a.a)+s.b.distance(a.b)<=s.a.distance(a.b)+s.b.distance(a.a))s else s.copy(a=s.b,b=s.a)

/** Low-rate, gesture-only line observations never enter the practice tracker or scores. */
class CrossScanner {
    private val detector=StaffDetector()
    private var last=Long.MIN_VALUE
    fun reset(){last=Long.MIN_VALUE}
    fun scan(pixels:IntArray,width:Int,height:Int,time:Long,c:Config):List<Segment>? {
        if(last!=Long.MIN_VALUE && time>=last && time-last<125)return null
        last=time
        val scale=min(1.0,192.0/max(width,height));val w=max(2,(width*scale).roundToInt());val h=max(2,(height*scale).roundToInt())
        val small=IntArray(w*h){i->val x=i%w;val y=i/w;pixels[min(height-1,((y+.5)*height/h).toInt())*width+min(width-1,((x+.5)*width/w).toInt())]}
        return detector.detect(small,w,h,c.copy(staffCount=2),linesOnly=true)
    }
}

fun findCross(candidates:List<Segment>,width:Int,height:Int):List<Segment>? {
    val unit=min(width,height).toDouble();val x=width/unit;val y=height/unit
    val good=candidates.filter {s->clearStaff(s) && s.length in .15..1.65 && listOf(s.a,s.b).all {it.x>.015 && it.x<x-.015 && it.y>.015 && it.y<y-.015}}
    fun cross(a:P,b:P)=a.x*b.y-a.y*b.x
    var best:List<Segment>?=null;var rank=Double.NEGATIVE_INFINITY
    for(i in good.indices)for(j in i+1 until good.size){
        val a=good[i];val b=good[j];val u=a.b-a.a;val v=b.b-b.a;val la=a.length;val lb=b.length;val den=cross(u,v)
        if(min(la,lb)<max(la,lb)*.55 || abs(den)/(la*lb)<.7)continue
        if(abs(u.x)/la<.3 || abs(u.y)/la<.3 || abs(v.x)/lb<.3 || abs(v.y)/lb<.3 || u.x*u.y*v.x*v.y>=0)continue
        val delta=b.a-a.a;val ta=cross(delta,v)/den;val tb=cross(delta,u)/den
        if(ta !in .25.. .75 || tb !in .25.. .75)continue
        val score=a.confidence+b.confidence+min(la,lb)-abs(ta-.5)-abs(tb-.5)
        if(score>rank){rank=score;best=listOf(a,b).sortedBy {val d=it.b-it.a;sign(d.x*d.y)}}
    }
    return best
}

data class GestureFrame(val state:String="idle",val active:Boolean=false,val remainingMs:Long=0,val progress:Double=0.0,val title:String="",val detail:String="") {
    fun json()=JSONObject().put("state",state).put("active",active).put("remainingMs",remainingMs).put("progress",progress).put("title",title).put("detail",detail)
}
data class GestureAction(val config:JSONObject,val seeds:List<Segment>?=null)

/** Deliberate X hold, get-ready countdown, then a fresh stationary grip measurement. */
class GestureAlignment {
    var suspended=false;private set
    var state="idle";private set
    var frame=GestureFrame();private set
    private var armed=true
    private var time:Long?=null
    private var crossAt=Long.MIN_VALUE
    private var crossPose:List<Segment>?=null
    private var holdPose:List<Segment>?=null
    private var holdSince:Long?=null
    private var releaseSince:Long?=null
    private var deadline=0L;private var started=0L;private var until=0L;private var waitUntil=0L
    private var zoomTried=false;private var note="";private var reason=""
    private var anchor:List<Segment>?=null
    private var reasonUntil=0L
    private var stillSince:Long?=null;private var sampleAt:Long?=null
    private val samples=mutableListOf<List<Segment>>()
    val active get()=state in listOf("countdown","settling","zooming","applying")
    val scans get()=!suspended && !active
    fun reset(armed:Boolean=true){
        state="idle";this.armed=armed;time=null;crossAt=Long.MIN_VALUE;crossPose=null;holdPose=null;holdSince=null;releaseSince=null;deadline=0;started=0;until=0;waitUntil=0;zoomTried=false;note="";reason="";reasonUntil=0;clearSamples();frame=status(0)
    }
    private fun clearSamples(){samples.clear();anchor=null;stillSince=null;sampleAt=null}
    fun cancel(t:Long,message:String="Alignment cancelled. Make a new X to try again."){
        state="cancelled";reason=message;until=t+3000;armed=false;holdSince=null;holdPose=null;releaseSince=null;clearSamples();frame=status(t)
    }
    fun suspend(value:Boolean,t:Long){suspended=value;reset(false);time=t}
    fun accept(t:Long,ok:Boolean=true){
        if(state !in listOf("zooming","applying"))return
        if(!ok){cancel(t,"Camera adjustment failed. Guide alignment was not completed.");return}
        if(state=="zooming"){state="settling";waitUntil=t+600;started=t;reason="Zoom adjusted. Keep your grips in place while the camera settles.";clearSamples()}
        else {state="success";until=t+4000;clearSamples()}
        frame=status(t)
    }
    private fun status(t:Long,count:Int=2):GestureFrame {
        var title="";var detail="";var remaining=0L;var progress=0.0
        when(state){
            "holding"->{remaining=max(0,X_HOLD-(t-(holdSince ?: t)));progress=1-remaining.toDouble()/X_HOLD;title="HOLD THE X · ${ceil(remaining/1000.0).toInt()}";detail="Keep both staves crossed and still. Release the X to stop."}
            "countdown"->{remaining=max(0,deadline-t);progress=1-remaining.toDouble()/X_COUNTDOWN;title="AUTO-ALIGNMENT IN ${ceil(remaining/1000.0).toInt()}";detail=if(count==1)"Uncross and put the second staff aside. Grip the remaining staff at its midpoint, put your hand at the new center, then hold still."else"Uncross. Grip each staff at its midpoint, put your hands at the new guide centers, then hold still."}
            "settling"->{remaining=stillSince?.let {max(0,X_STILL-(t-it))} ?: X_STILL;progress=1-remaining.toDouble()/X_STILL;title="HOLD STILL · ALIGNING";detail=reason.ifEmpty {"Keep your grip positions and both ends of each staff still and visible."}}
            "zooming"->{title="ADJUSTING CAMERA ZOOM";detail="Keep your hands at the intended centers. The guide will be measured again after zoom settles."}
            "applying"->{title="APPLYING ALIGNMENT";detail="Keep still for a moment."}
            "success"->{title="ALIGNMENT SET";detail="Center and guide size now follow your grip positions. ${note}Separate the staves before making another X.";progress=1.0}
            "cancelled"->{title="ALIGNMENT CANCELLED";detail=reason}
        }
        return GestureFrame(state,active,remaining,progress.coerceIn(0.0,1.0),title,detail)
    }
    fun update(t:Long,candidates:List<Segment>?,staffs:List<Segment?>,g:Guide,zoomMin:Double=1.0,zoomMax:Double=1.0,zoom:Double=1.0,blocked:Boolean=false):GestureAction? {
        val c=g.config
        if(!c.gestureEnabled || blocked || suspended){reset(false);return null}
        if(time?.let {t<it || t-it>1000}==true){if(active)cancel(t,"Camera frames were interrupted. Make a new X when ready.")else reset(false)}
        if(time?.let {t-it>X_GAP}==true){holdSince=null;holdPose=null;clearSamples()}
        val duplicate=t==time;time=t
        if(candidates!=null){
            crossAt=t;crossPose=findCross(candidates,g.width,g.height)
            if(crossPose==null){holdSince=null;holdPose=null;if(state=="holding")state="idle";if(releaseSince==null)releaseSince=t;if(t-releaseSince!!>=1000)armed=true}
            else releaseSince=null
        }
        if(crossAt==Long.MIN_VALUE || t-crossAt>X_GAP){crossPose=null;holdSince=null;holdPose=null;if(state=="holding")state="idle"}
        if(state in listOf("success","cancelled") && t>=until)state="idle"
        if(state in listOf("idle","holding") && armed && crossPose!=null && candidates!=null){
            if(holdPose==null || !crossPose!!.indices.all {stablePose(crossPose!![it],holdPose!![it])}){holdPose=crossPose;holdSince=t}
            state="holding"
            if(t-holdSince!!>=X_HOLD){state="countdown";deadline=t+X_COUNTDOWN;armed=false;zoomTried=false;note="";clearSamples()}
        }
        var action:GestureAction?=null
        if(state=="countdown" && t>=deadline){state="settling";started=t;waitUntil=t;reason="Hold still while the guide measures your grip positions.";clearSamples()}
        if(state in listOf("zooming","applying") && t-started>8000)cancel(t,"Camera adjustment took too long. Make a new X to try again.")
        if(state=="settling"){
            if(t-started>25000)cancel(t,"Could not get a steady, clear pose. Make a new X to try again.")
            else if(t>=waitUntil && !duplicate){
                val measured=staffs.take(c.staffCount).map {if(clearStaff(it))g.rectify(it!!)else null}
                if(measured.size!=c.staffCount || measured.any {it==null}){clearSamples();reason="Hold ${if(c.staffCount==1)"one staff"else"both staves"} still with every end visible. Uncross the staves so each can be measured."}
                else {
                    val good=measured.filterNotNull()
                    if(anchor==null || sampleAt==null || t-sampleAt!!>X_GAP || !good.indices.all {stablePose(good[it],anchor!![it])}){clearSamples();anchor=good;stillSince=t}
                    sampleAt=t;samples.add(good.mapIndexed {i,s->orderedPose(s,anchor!![i])});if(t>=reasonUntil)reason="Measuring your still pose. Keep gripping each staff at its midpoint."
                    if(t-stillSince!!>=X_STILL && samples.size>=8)action=fit(t,g,zoomMin,zoomMax,zoom)
                }
            }
        }
        frame=status(t,c.staffCount);return action
    }
    private fun fit(t:Long,g:Guide,zoomMin:Double,zoomMax:Double,zoom:Double):GestureAction? {
        val c=g.config
        val poses=(0 until c.staffCount).map {i->Segment(P(samples.map {it[i].a.x}.average(),samples.map {it[i].a.y}.average()),P(samples.map {it[i].b.x}.average(),samples.map {it[i].b.y}.average()),1.0)}.sortedBy {g.local(it.center).x}
        val centers=poses.map {it.center};val grip=P(centers.map {it.x}.average(),centers.map {it.y}.average());val len=poses.map {it.length}.average()
        val scale=when(c.mode){"antispin"->len;"cube"->len/2/(1+c.cubeDepth/2);else->len/2}
        if(!zoomTried && !g.calibrated && zoomMax>zoomMin){
            val radius=if(c.mode=="antispin")len else len/2
            val extentX=centers.maxOf {abs(it.x-g.planeX/2)+radius};val extentY=centers.maxOf {abs(it.y-g.planeY/2)+radius}
            val desired=(zoom*minOf(1.5,g.planeX*.42/extentX,g.planeY*.42/extentY,.46/scale)).coerceIn(zoomMin,zoomMax);zoomTried=true
            if(abs(desired-zoom)>zoom*.08){state="zooming";started=t;clearSamples();return GestureAction(JSONObject().put("zoom",desired))}
        }
        val cx=grip.x/g.planeX;val cy=grip.y/g.planeY
        if(cx !in .1.. .9 || cy !in .1.. .9){clearSamples();reasonUntil=t+2500;reason="Bring your grip positions farther inside the camera view, then hold still.";return null}
        val patch=JSONObject().put("cx",cx).put("cy",cy).put("scale",scale.coerceIn(.1,.48))
        if(c.staffCount==2 && c.mode in listOf("circles","antispin")){
            val a=g.local(centers[0]);val b=g.local(centers[1]);val separation=abs(b.x-a.x)/patch.getDouble("scale")
            if(abs(b.y-a.y)>max(.025,len*.10) || separation>1.8){clearSamples();reasonUntil=t+2500;reason="Keep your grip positions along the guide’s horizontal axis and a little closer together, then hold still.";return null}
            patch.put("circleSeparation",separation)
        }
        note=if(g.calibrated)"Viewing-angle calibration kept the current zoom. "else if(zoomMax<=zoomMin)"This camera has fixed zoom. "else""
        if(scale!=patch.getDouble("scale"))note+="Guide size reached its limit; adjust camera framing if needed. "
        state="applying";started=t
        return GestureAction(patch,poses.map {it.copy(a=g.project(it.a),b=g.project(it.b))})
    }
}
