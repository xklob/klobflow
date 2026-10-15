package com.caleb.klobflow

import kotlin.math.*

/** Text for one fixed status box. Equal values never restart a transition.
 *  [cues] marks text that refers to correction marks currently drawn on the camera view. */
data class BoxText(val tone:String,val title:String,val detail:String,val number:Double=0.0,val cues:Boolean=false)
data class Coaching(val state:String,val title:String,val detail:String,val tips:List<TipCue> = emptyList(),
    val tracking:BoxText=BoxText("idle","NO CAMERA YET","Open the camera or try the demo."),val trackingConfirmed:Boolean=false,val cues:Boolean=false,val summary:BoxText?=null)

private val issueRank=mapOf("uncertain" to 1,"blur" to 2,"hidden" to 3,"missing" to 4)

/** The most limiting tracking problem in this frame, or null when every staff is clear. */
fun trackingIssue(staffs:List<Segment?>,count:Int):Pair<String,Int>? {
    var issue:Pair<String,Int>?=null;var missing=0
    for(i in 0 until count){
        val s=staffs.getOrNull(i)
        val kind=when{s==null->"missing";s.occluded->"hidden";s.blurred->"blur";s.confidence<.55->"uncertain";else->null} ?: continue
        if(kind=="missing")missing++
        if(issue==null||issueRank.getValue(kind)>issueRank.getValue(issue.first))issue=kind to i
    }
    return if(issue!=null&&missing==count)"missing" to -1 else issue
}

private fun describeIssue(issue:Pair<String,Int>,count:Int):BoxText {
    val (kind,staff)=issue
    return when(kind){
        "missing"->BoxText("warn",if(staff<0)(if(count==1)"NO STAFF FOUND" else "NO STAVES FOUND") else if(count==1)"STAFF NOT FOUND" else "STAFF ${"AB"[staff]} NOT FOUND","Keep the whole staff lit and in frame. Scores pause until it is found.")
        "hidden"->BoxText("warn","END HIDDEN","An end is covered or outside the frame. Keep both ends in view.")
        "blur"->BoxText("warn","ENDS UNCLEAR","The glow is visible, but both ends cannot be located reliably. This frame is excluded.")
        "uncertain"->BoxText("warn","UNSURE","Crossing staves or a faint shape. Scores pause until tracking is sure.")
        "outside"->BoxText("warn","OUTSIDE PLANE","A tip left the calibrated rectangle. Scores pause until every tip is inside it.")
        else->BoxText("warn","LOCKING ON","Keep your staves in view while tracking confirms them.")
    }
}

/** Presentation hysteresis never changes scores or makes uncertain observations valid. */
class AlignmentFeedback {
    private var time=-1L;private var key="";private var lastIssue:Pair<String,Int>?=null
    private var lastPacerElapsed:Double?=null
    private data class Sample(val time:Long,val valid:Boolean,val on:Boolean,val horizontal:Double?=null,val vertical:Double?=null)
    private val samples=ArrayList<Sample>()
    private var onSince=arrayOfNulls<Long>(4);private var on=BooleanArray(4);private var alignedSince:Long?=null
    private fun clear(){onSince=arrayOfNulls(4);on=BooleanArray(4);alignedSince=null}
    fun update(t:Long,staffs:List<Segment?>,guide:Guide,background:BackgroundStatus=BackgroundStatus(),pacer:PacerFrame?=null):Coaching {
        val c=guide.config
        val following=c.pacerEnabled && c.mode in listOf("circles","antispin")
        val idle=following && (pacer?.enabled!=true || pacer.state!="running")
        val nextKey="${c.mode}/${c.staffCount}/${c.tolerance}/${c.planeCorners}/${c.cx}/${c.cy}/${c.scale}/${c.rotation}/${c.circleSeparation}/${guide.width}/${guide.height}/${c.staffColors}/${c.threshold}/${c.minLength}/${c.led}/${c.facing}/${c.mirror}/${c.zoom}/$following/${if(following)pacer?.state else null}/${c.pacerRpm}/${c.pacerDirection}/${c.pacerPattern}/${c.pacerOffset}/${c.pacerCountdown}"
        val restarted=following && !idle && lastPacerElapsed?.let {pacer!!.elapsedSeconds<it}==true
        if(t<time||nextKey!=key||restarted){clear();lastIssue=null;samples.clear()}
        time=t;key=nextKey
        lastPacerElapsed=if(following&&!idle)pacer!!.elapsedSeconds else null
        val count=c.staffCount;val free=c.mode=="free";val cues=if(following)pacer?.feedback.orEmpty()else guide.cues(staffs)
        val issue=if(idle)null else trackingIssue(staffs,count) ?: if(!free&&(cues.size!=count*2 || following && pacer?.valid!=true))"outside" to -1 else null
        if(issue!=null){clear();lastIssue=issue}
        // While the background snapshot runs the staves must stay out of view: never ask for them back.
        val snapshot=background.state=="countdown"||background.state=="capturing"
        // The tracker already confirms consecutive observations. Do not add a text-delay gate to scores.
        val confirmed=issue==null&&!snapshot&&!idle
        samples.removeAll {t-it.time>5000||it.time==t}
        fun axisMean(axis:String)=cues.filter {it.axis==axis}.map {it.error}.takeIf {it.isNotEmpty()}?.average()
        if(snapshot||idle)samples.clear() else samples.add(Sample(t,confirmed,confirmed&&cues.size==count*2&&cues.all {it.error<=c.tolerance},if(confirmed)axisMean("horizontal") else null,if(confirmed)axisMean("vertical") else null))
        val measured=samples.filter {it.valid};val recent=measured.size>=3&&t-measured.last().time<=(if(issue?.first=="hidden")1500 else 1000)
        val coverage=(measured.size*100.0/max(1,samples.size)).roundToInt()
        val onPercent=if(measured.isEmpty())0 else (measured.count {it.on}*100.0/measured.size).roundToInt()
        val tolerance=if(c.tolerance%1.0==0.0)c.tolerance.toInt().toString()else c.tolerance.toString()
        val axisDetail=if(c.mode=="antispin"&&recent)"Horizontal ${if(count==2)"tips (A+B)"else"tip"}: %.1f%% ${if(following)"gap"else"drift"} · Vertical ${if(count==2)"tips (A+B)"else"tip"}: %.1f%% ${if(following)"gap"else"drift"}. ".format(measured.mapNotNull {it.horizontal}.average(),measured.mapNotNull {it.vertical}.average())else ""
        val summary=if(recent&&!free&&!snapshot)BoxText(if(onPercent>=80)"ok" else "warn","$onPercent% ${if(following)"WITH DOTS"else"ON TARGET"}",axisDetail+"Of measured frames in the last 5 seconds. "+(if(following)"All tips must follow the moving blue dots. "else"")+"Tolerance: $tolerance% of guide width. Unclear frames are excluded.")else null
        val idleTitle=when(pacer?.state){"countdown"->"GET READY";"paused"->"GUIDE DOTS PAUSED";else->"GUIDE DOTS READY"}
        val idleDetail=when(pacer?.state){"countdown"->"Place your tips on the blue dots. Scoring starts when they move.";"paused"->"Resume to continue from these dot positions. Scores are paused.";else->"Set your speed, then press Start dots. Match all tips to their blue dots."}
        val tracking=when{
            snapshot->BoxText("wait","BACKGROUND SNAPSHOT","Move your staves out of view and keep the phone still.")
            idle->BoxText("wait",idleTitle,idleDetail)
            recent->BoxText(if(coverage>=80)"ok" else "warn","$coverage% MEASURED","Frames with both ends located, over the last 5 seconds. Unclear frames pause live scores and rings.")
            confirmed->BoxText("ok","CLEAR",if(count==1)"Your staff and both of its ends are sharp." else "Both staves and all four ends are sharp.")
            // StableText holds and fades text independently of current measurements.
            else->describeIssue(issue ?: lastIssue ?: ("starting" to -1),count)
        }
        fun result(state:String,title:String,detail:String,tips:List<TipCue> = emptyList(),cues:Boolean=false)=Coaching(state,title,detail,tips,tracking,confirmed,cues,summary)
        if(free)return result("free","FREE FLOW",if(c.trails)"No alignment score here. Faint curves show where each tip traveled." else "No alignment score here. Choose Grid, Circles or Cube for targets.")
        if(snapshot)return result("paused","PRECISION PAUSED","Scores resume after the background snapshot.")
        if(idle)return result("practice",if(idleTitle=="GUIDE DOTS READY")"READY TO FOLLOW"else idleTitle,idleDetail)
        if(!confirmed)return result("paused","PRECISION PAUSED","No current measurement. Keep both ends lit and in view; unclear frames are excluded.")
        val tips=cues.mapIndexed {i,cue->
            if(cue.error>c.tolerance){on[i]=false;onSince[i]=null}
            else if(!on[i]){if(cue.error<=c.tolerance*.85){if(onSince[i]==null)onSince[i]=t;if(t-onSince[i]!!>=300)on[i]=true}else onSince[i]=null}
            cue.copy(onTarget=on[i])
        }
        if(tips.all {it.onTarget}){if(alignedSince==null)alignedSince=t}else alignedSince=null
        val aligned=alignedSince?.let {t-it>=1200}==true
        if(aligned)return result("aligned",if(following)"WITH THE DOTS"else"ON GUIDE",if(following)"All tips are following the moving blue dots. Keep the same pace."else"Every tip is within tolerance. Keep tracing the guide.",tips)
        // Every tip is inside tolerance but not yet confirmed: no correction marks are drawn, so name none.
        if(tips.all {it.error<=c.tolerance})return result("settling",if(following)"TIPS WITH DOTS"else"TIPS ON TARGET",if(following)"All tips are within tolerance. Keep following the blue dots."else"Every tip is within tolerance. Keep tracing the guide to confirm ON GUIDE.",tips)
        return result("adjust",if(following)"FOLLOW THE DOTS"else"OFF GUIDE",if(following)"Bring all tips onto their moving blue dots and keep their pace."else if(c.showFeedback)"Move each amber-ringed tip along its arrow into the white TARGET ring." else "Some tips are outside tolerance. Turn on Alignment cues to see where to move.",tips,c.showFeedback)
    }
}

/** Rate-limits text changes so rapid events never restart a transition every frame.
 *  Urgent changes show at once; others wait until the current text has been visible for [holdMs]. */
class StableText<T:Any>(private val holdMs:Long=2600) {
    private var shown:T?=null;private var since=0L
    var urgent=false;private set
    fun reset(){shown=null}
    fun update(now:Long,next:T,isUrgent:(T,T)->Boolean):T {
        val current=shown ?: run {shown=next;since=now;urgent=true;return next}
        if(current==next)return current
        val immediate=isUrgent(current,next)
        if(!immediate&&now-since<holdMs)return current
        shown=next;since=now;urgent=immediate;return next
    }
}

private val sectors=listOf("→" to "RIGHT","↘" to "DOWN-RIGHT","↓" to "DOWN","↙" to "DOWN-LEFT","←" to "LEFT","↖" to "UP-LEFT","↑" to "UP","↗" to "UP-RIGHT")
/** Screen direction from a tip toward its target, with hysteresis so the word does not flicker at sector edges. */
fun direction(dx:Double,dy:Double,previous:Int=-1):Pair<Int,String> {
    val angle=(atan2(dy,dx)+2*PI)%(2*PI)
    val sector=if(previous>=0&&abs(atan2(sin(angle-previous*PI/4),cos(angle-previous*PI/4)))<PI/8+PI/14)previous else (angle/(PI/4)).roundToInt()%8
    return sector to "${sectors[sector].first} ${sectors[sector].second}"
}
