package com.caleb.klobflow

import android.animation.ValueAnimator
import android.content.Context
import android.os.SystemClock
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

@Composable fun ModeTutorial(mode:String) {
    val context=LocalContext.current
    val prefs=remember {context.getSharedPreferences("tutorials",Context.MODE_PRIVATE)}
    val guides=remember {JSONObject(context.assets.open("practice-guides.json").bufferedReader().use {it.readText()})}
    val guide=guides.getJSONObject(mode);val steps=guide.getJSONArray("steps")
    var dismissed by remember(mode){mutableStateOf(prefs.getBoolean(mode,false))}
    var expanded by remember(mode){mutableStateOf(false)}
    if(!dismissed)Surface(color=Color(0xff223126),shape=RoundedCornerShape(12.dp),modifier=Modifier.fillMaxWidth().padding(bottom=8.dp)) {
        Column(Modifier.padding(12.dp)){
            Text(guide.getString("title"),color=Lime,fontSize=17.sp,fontWeight=FontWeight.SemiBold)
            Text(steps.getString(0),fontSize=15.sp,lineHeight=20.sp,color=Ink,modifier=Modifier.padding(top=4.dp))
            Row {TextButton(onClick={expanded=true}){Text("Setup tutorial")};TextButton(onClick={dismissed=true;prefs.edit().putBoolean(mode,true).apply()}){Text("Got it")}}
        }
    } else TextButton(onClick={expanded=true}){Text("Show mode tutorial")}
    if(expanded)AlertDialog(onDismissRequest={expanded=false},title={Text(guide.getString("title"))},text={Column(Modifier.verticalScroll(rememberScrollState())){repeat(steps.length()){Text("${it+1}. ${steps.getString(it)}",fontSize=16.sp,lineHeight=22.sp,modifier=Modifier.padding(bottom=12.dp))}}},confirmButton={TextButton(onClick={expanded=false;dismissed=true;prefs.edit().putBoolean(mode,true).apply()}){Text("Got it")}})
}
@Composable fun FitControls(ui:FlowUi,engine:FlowEngine) {
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp),modifier=Modifier.padding(top=8.dp)){
        OutlinedButton(enabled=ui.frame!=null,onClick={engine.command(JSONObject().put("action","fit").put("zoom",true))}){Text("Auto-fit")}
        OutlinedButton(enabled=ui.frame!=null,onClick={engine.command(JSONObject().put("action","fit").put("sizeOnly",true))}){Text("Match staff length")}
    }
    // Resets only the guide's placement; camera, tempo, staff count and calibration stay as they are.
    TextButton(onClick={val defaults=Config();engine.updateConfig(JSONObject().put("cx",defaults.cx).put("cy",defaults.cy).put("scale",defaults.scale).put("rotation",defaults.rotation).put("circleSeparation",defaults.circleSeparation))}){Text("Reset guide layout")}
    Text(ui.frame?.fitStatus?.takeIf {it.isNotEmpty()} ?: "Get into position, then press Auto-fit and spin normally for two seconds with your full staves in view. Match staff length changes size only.",fontSize=15.sp,lineHeight=20.sp,color=Ink)
    Text("Reset guide layout recenters the guide and restores its default size, rotation and circle separation.",fontSize=14.sp,lineHeight=19.sp,color=Muted,modifier=Modifier.padding(top=4.dp))
    val lengths=ui.frame?.let {f->f.staffs.take(ui.config.staffCount).mapNotNull {s->s?.takeIf {it.confidence>=.7 && !it.occluded}?.let(f.guide::rectify)?.length}}.orEmpty()
    if(lengths.isNotEmpty())Text((if(ui.config.mode=="antispin")"Cross width / staff length: %.2f×. Match staff length sets 2×: center to each outer end is one full staff."else"Guide width / staff length: %.2f×. Match staff length sets 1×; adjust Size for your pattern.").format(ui.config.scale*2/lengths.average()),fontSize=14.sp,lineHeight=19.sp,color=Muted,modifier=Modifier.padding(top=4.dp,bottom=8.dp))
}
@Composable fun BeatSettings(ui:FlowUi,engine:FlowEngine) {
    AudioControls(ui,engine)
    var bpm by remember(ui.config.bpm){mutableStateOf(ui.config.bpm.roundToInt().toString())}
    var taps by remember {mutableStateOf(emptyList<Long>())}
    Row(verticalAlignment=Alignment.CenterVertically) {Text("Beat practice",Modifier.weight(1f),fontSize=16.sp);Switch(ui.config.tempoEnabled,onCheckedChange={engine.updateConfig(JSONObject().put("tempoEnabled",it))})}
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        OutlinedTextField(value=bpm,onValueChange={bpm=it.filter(Char::isDigit).take(3)},label={Text("BPM (30–240)")},singleLine=true,modifier=Modifier.weight(1f))
        Button(enabled=bpm.toIntOrNull() in 30..240,onClick={engine.updateConfig(JSONObject().put("bpm",bpm.toInt()).put("tempoEnabled",true).put("tempoSource","manual"))}){Text("Set")}
    }
    if(ui.config.mode=="antispin")Text("4 outer turnarounds per cycle · alternate tips",fontSize=16.sp,color=Cyan)
    else Row {listOf(2,4,8).forEach {n->FilterChip(selected=ui.config.beatPoints==n,onClick={engine.updateConfig(JSONObject().put("beatPoints",n))},label={Text("$n points")},modifier=Modifier.padding(end=6.dp))}}
    Row {
        TextButton(enabled=ui.config.tempoSource=="manual",onClick={engine.command(JSONObject().put("action","syncBeat"))}){Text("Start beat now")}
        TextButton(onClick={val now=SystemClock.elapsedRealtime();taps=if(taps.isEmpty() || now-taps.last()>2000)listOf(now)else (taps+now).takeLast(6);if(taps.size>1){val tempo=(60000.0*(taps.size-1)/(now-taps.first())).roundToInt().coerceIn(30,240);engine.updateConfig(JSONObject().put("bpm",tempo).put("tempoEnabled",true).put("tempoSource","manual"));engine.command(JSONObject().put("action","syncBeat"))}}){Text("Tap tempo")}
    }
    var help by remember {mutableStateOf(false)}
    TextButton(onClick={help=true}){Text("How beat practice works")}
    if(help)AlertDialog(onDismissRequest={help=false},title={Text("Hit a point on each beat")},text={Column(Modifier.verticalScroll(rememberScrollState())){
        ((if(ui.config.mode=="antispin")listOf("Alternate the two tips at the four outer ends of the cross: top → right → bottom → left, or reverse. Reach one outer end on each blue pulse. All four rings pulse together; start anywhere. At 120 BPM, one full cycle takes 2 seconds.",
            "With two staves, each follows its own A or B cross and gets a separate beat result. The horizontal tip moves left/right; the vertical tip moves up/down. Timing uses their combined cycle phase to estimate each turnaround. Position measures the arriving tip against that outer target. The pulse is silent.")else listOf("Follow the end labeled BEAT TIP. Only that end is timed. Pass it across a numbered target on each blue pulse, in either direction. The pulse is visual; there is no metronome sound.",
            "With 4 points at 120 BPM: top → right → bottom → left on successive beats. One full circle takes 2 seconds. Try 2 points first. All target rings pulse together; numbers label positions, not a required starting point."))+listOf(
            "On beat means within 75 ms early or late. On target means within your Target tolerance. These are separate checks. Hidden or unclear tips do not produce a beat result.",
            "Start beat now resets the manual pulse. Tap tempo sets its speed from your taps. System audio follows its detected beat. Adjust Audio offset if the pulse consistently leads or lags the music.")
            ).forEach {Text(it,fontSize=16.sp,lineHeight=22.sp,modifier=Modifier.padding(bottom=12.dp))}
    }},confirmButton={TextButton(onClick={help=false}){Text("Got it")}})
}
/** Timing box: the text holds and fades slowly; only the small dot pulses on the beat. */
@Composable fun BeatFeedback(ui:FlowUi,compact:Boolean=false) {
    val f=ui.frame ?: return
    val beat=f.beat
    val paused=!beat.enabled && ui.config.tempoEnabled && ui.config.tempoSource!="manual"
    if(!beat.enabled && !paused)return
    val next=if(paused)BoxText("wait","Beat timing paused",if(f.audio.status.contains("Following"))"Waiting for fresh audio timing." else f.audio.status)
    else BoxText("timing","${beat.bpm.roundToInt()} BPM",beat.hits.mapIndexed {i,hit->
        val name=if(i==0)"A" else "B"
        if(hit==null)(if(ui.config.mode=="antispin")"Alternate tips at the four outer turnarounds, one per pulse." else "$name · pass the BEAT TIP across a numbered target on a pulse") else {
            val timing=if(abs(hit.offsetMs)<=75)"on beat" else "${abs(hit.offsetMs).roundToInt()} ms ${if(hit.offsetMs<0)"early" else "late"}"
            "$name · ${if(ui.config.mode=="antispin")"turnaround"else"point"} ${hit.point}: $timing · ${if(hit.error<=ui.config.tolerance)"on target" else "off target"} (${"%.1f".format(hit.error)}%)"
        }
    }.joinToString("\n"),beat.bpm)
    val pulse=beat.enabled && beat.phase<.18
    val (text,urgentChange)=rememberHeldText(next){a,b->(a.tone=="wait")!=(b.tone=="wait")||abs(a.number-b.number)>3}
    StatusBox("Timing",text,urgentChange,Modifier.padding(bottom=8.dp),compact=compact){BeatDot(pulse)}
}
@Composable private fun BeatDot(pulse:Boolean) {
    val motion=ValueAnimator.areAnimatorsEnabled()
    val grow by animateFloatAsState(if(pulse && motion)1.6f else 1f,tween(if(motion)110 else 0),label="beatDot")
    Box(Modifier.size(11.dp).scale(grow).background(if(pulse)Cyan else Color(0xff2a4f5d),CircleShape))
}

@Composable fun AudioControls(ui:FlowUi,engine:FlowEngine) {
    val phone by PhoneAudio.state.collectAsStateWithLifecycle()
    val state=if(ui.config.tempoSource=="phone")phone else ui.frame?.audio ?: AudioTempo()
    val owner=LocalLifecycleOwner.current
    var now by remember {mutableDoubleStateOf(SystemClock.elapsedRealtime().toDouble())}
    LaunchedEffect(owner){owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED){while(true){now=SystemClock.elapsedRealtime().toDouble();delay(100)}}}
    val checkedAt=max(now,SystemClock.elapsedRealtime().toDouble())
    val manual=ui.config.tempoSource=="manual"
    val fresh=!manual && state.running && checkedAt-state.at in -100.0..2000.0
    val remaining=if(fresh && state.holding && state.holdRemainingMs.isFinite())max(0.0,state.holdRemainingMs.coerceIn(0.0,15000.0)-(checkedAt-state.at).coerceAtLeast(0.0))else 0.0
    val holding=fresh && state.holding && remaining>0
    val expiredHold=fresh && state.holding && !holding
    val level=if(fresh && state.level.isFinite())state.level.coerceIn(0.0,1.0)else 0.0
    val quiet=level<.001
    val silent=fresh && !holding && (state.status.startsWith("No shared audio") || quiet && state.historySeconds<=0 && state.bpm==null && state.confidence<=0)
    val confidence=if(fresh && !silent && !expiredHold && state.confidence.isFinite())state.confidence.coerceIn(0.0,1.0)else 0.0
    val percent=(confidence*100).roundToInt()
    val history=if(fresh && !silent && state.historySeconds.isFinite())state.historySeconds.coerceIn(0.0,8.0)else 0.0
    val candidate=state.candidateBpm?.takeIf {fresh && !silent && it.isFinite()}
    val locked=fresh && !silent && state.usable(checkedAt)
    val soundLabel=if(manual || !state.running)"Off"else if(!fresh)"No signal"else if(quiet)"Quiet"else"Sound"
    val soundLevel=if(level<=.001)0.0 else ((log10(level)+3)/3).coerceIn(0.0,1.0)
    val progress=when{
        manual->"Connect system audio to begin."
        !state.running->state.status
        !fresh->"Waiting for fresh audio timing."
        expiredHold->"Waiting for a new beat"
        holding->"Holding tempo · ${ceil(remaining/1000).toInt()}s left"
        silent->"No shared audio. Play music and check sharing."
        locked->"Beat locked"
        history<2.4->"Collecting audio · %.1f / 2.4 s minimum".format(history)
        candidate!=null->"Possible ${candidate.roundToInt()} BPM · not locked"
        else->"Searching for a steady beat"
    }
    Text("Tempo source",color=Lime,fontSize=16.sp,modifier=Modifier.padding(top=12.dp))
    Row {
        TextButton(onClick={engine.command(JSONObject().put("action","audioStart"))}){Text(if(phone.running)"Use phone audio"else"Connect system audio")}
        TextButton(onClick={engine.command(JSONObject().put("action","audioStop"))}){Text("Use manual / stop")}
    }
    val status=if(manual)"Manual BPM"else "${if(ui.config.tempoSource=="phone")"Phone"else"PC"} audio · "+when{
        locked->"${(state.bpm!!*ui.config.audioRate).roundToInt()} BPM · "+if(holding)"holding tempo"else"$percent% confidence"
        !state.running || !fresh || silent || expiredHold->progress
        else->"Listening for a steady beat"
    }
    Text(status,fontSize=15.sp,color=Ink)
    Surface(color=Color(0xff101913),shape=RoundedCornerShape(10.dp),border=BorderStroke(1.dp,Color(0xff3e5148)),modifier=Modifier.fillMaxWidth().padding(vertical=10.dp)){
        Column(Modifier.padding(12.dp)){
            AudioMeter("Incoming sound",soundLabel,soundLevel.toFloat())
            Spacer(Modifier.height(10.dp))
            AudioMeter(if(holding)"Last beat confidence"else"Beat confidence","$percent%",confidence.toFloat(),lockMarker=true)
            Text("Locks at 60% · confidence in a repeating beat",fontSize=13.sp,lineHeight=18.sp,color=Muted,modifier=Modifier.padding(top=5.dp))
            Text(progress,fontSize=15.sp,lineHeight=20.sp,color=Ink,modifier=Modifier.padding(top=10.dp).heightIn(min=40.dp))
        }
    }
    Row {listOf(.5 to "Half",1.0 to "Detected",2.0 to "Double").forEach {(rate,label)->FilterChip(selected=ui.config.audioRate==rate,onClick={engine.updateConfig(JSONObject().put("audioRate",rate))},label={Text(label)},modifier=Modifier.padding(end=6.dp))}}
    var offset by remember(ui.config.audioOffsetMs){mutableFloatStateOf(ui.config.audioOffsetMs.toFloat())}
    Text("Audio offset: ${offset.toInt()} ms (positive = later)",fontSize=15.sp)
    Slider(value=offset,onValueChange={offset=it},onValueChangeFinished={engine.updateConfig(JSONObject().put("audioOffsetMs",offset.toDouble()))},valueRange=-500f..500f)
    Text("Approve Android's sharing prompt. The source app must allow playback capture. To follow PC music, choose Use PC system audio in the companion. After 3s of a stable beat, tempo can hold for up to 15s through a dropout. Stopping capture or choosing manual ends the hold. Audio stays local and is not recorded.",fontSize=14.sp,lineHeight=19.sp,color=Muted)
}

@Composable private fun AudioMeter(label:String,value:String,progress:Float,lockMarker:Boolean=false) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically){
        Text(label,Modifier.weight(1f),fontSize=15.sp,color=Ink)
        Text(value,fontSize=15.sp,color=Cyan,fontWeight=FontWeight.SemiBold)
    }
    BoxWithConstraints(Modifier.fillMaxWidth().padding(top=6.dp).height(9.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xff2b3935))){
        Box(Modifier.fillMaxWidth(progress).fillMaxHeight().background(Cyan))
        if(lockMarker)Box(Modifier.offset(x=maxWidth*.6f).width(2.dp).fillMaxHeight().background(Ink))
    }
}

fun toneColor(tone:String)=when(tone){"ok"->Mint;"warn"->Amber;"wait"->Slate;"timing"->Cyan;else->Color(0xff9aa591)}
private fun toneFill(tone:String)=when(tone){"ok"->Color(0xff13241c);"warn"->Color(0xff2a2014);"wait"->Color(0xff1a1f26);"timing"->Color(0xff12252d);else->Color(0xff171c16)}
@Composable fun ToneDot(tone:String){Box(Modifier.size(10.dp).background(toneColor(tone),CircleShape))}
/** Holds each message long enough to read and returns the text to show plus whether that change is urgent.
 *  Value-returning composables are never skipped, so a held change applies on the next frame after its hold. */
@Composable fun rememberHeldText(next:BoxText,urgent:(BoxText,BoxText)->Boolean):Pair<BoxText,Boolean> {
    val stable=remember {StableText<BoxText>()}
    val text=stable.update(SystemClock.uptimeMillis(),next,urgent)
    return text to stable.urgent
}
/** A fixed status box. The old text fades out before the new text fades in, so two paragraphs never
 *  overlap. Urgent changes (for example tracking loss) replace it at once. */
@Composable fun StatusBox(label:String,text:BoxText,urgentChange:Boolean,modifier:Modifier=Modifier,compact:Boolean=false,head:@Composable (String)->Unit={ToneDot(it)}) {
    val motion=ValueAnimator.areAnimatorsEnabled()
    var shown by remember {mutableStateOf(text)}
    val fade=remember {Animatable(1f)}
    LaunchedEffect(text){
        if(text==shown)return@LaunchedEffect
        if(!motion || urgentChange){fade.snapTo(1f);shown=text;return@LaunchedEffect}
        fade.animateTo(0f,tween(650));shown=text;fade.animateTo(1f,tween(750))
    }
    val tone=toneColor(shown.tone)
    val fill by animateColorAsState(toneFill(shown.tone),tween(if(motion)600 else 0),label="${label}Fill")
    Surface(color=fill,shape=RoundedCornerShape(12.dp),border=BorderStroke(1.5.dp,tone.copy(alpha=.7f)),modifier=modifier.fillMaxWidth()){
        Column(Modifier.padding(horizontal=14.dp,vertical=10.dp)){
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){head(shown.tone);Text(label.uppercase(),color=Muted,fontSize=12.sp,letterSpacing=1.5.sp)}
            // A minimum text height keeps the box (and the camera preview below it) from jumping between messages.
            Column(Modifier.heightIn(min=if(compact)28.dp else 86.dp).alpha(fade.value)){
                Text(shown.title,color=tone,fontSize=21.sp,lineHeight=25.sp,fontWeight=FontWeight.Bold,modifier=Modifier.padding(top=2.dp))
                if(shown.detail.isNotEmpty() && (!compact || label=="Timing" || shown.detail.startsWith("Horizontal tip:")))Text(if(compact && shown.detail.startsWith("Horizontal tip:"))shown.detail.substringBefore(". ")+" · 5s"else shown.detail,color=Ink,fontSize=15.sp,lineHeight=20.sp,modifier=Modifier.padding(top=3.dp))
            }
        }
    }
}

private val swatches=mapOf("red" to Color(0xffff4b4b),"orange" to Color(0xffff9a3c),"yellow" to Color(0xffffe14d),"green" to Color(0xff4be37a),"cyan" to Color(0xff3fe0f0),"blue" to Color(0xff4b7bff),"purple" to Color(0xffa35bff),"pink" to Color(0xffff5fc8),"white" to Color.White)
private fun colorName(name:String)=name.replaceFirstChar {it.uppercase()}
/** Conspicuous summary for diagnosing false detections. */
fun detectionSummary(c:Config,background:String):String {
    val colors=if(!c.led)"LED detection off (edge mode)" else if(c.staffColors.isEmpty())"Detecting LEDs of any color" else "Detecting ${c.staffColors.joinToString(" + ",transform=::colorName)} LEDs only"
    return "$colors · "+when(background){"ready"->"background snapshot on";"countdown","capturing"->"capturing background";else->"no background snapshot"}
}
/** LED colors to detect. An empty list means any color, including rainbow patterns. */
@Composable fun StaffColorPicker(ui:FlowUi,engine:FlowEngine,onError:(String)->Unit) {
    val c=ui.config
    fun choose(colors:List<String>){try{engine.updateConfig(JSONObject().put("staffColors",JSONArray(colors)))}catch(e:Exception){onError(e.message ?: "Could not change LED colors")}}
    Text("LED colors to detect",fontSize=16.sp,modifier=Modifier.padding(top=14.dp))
    Text(if(!c.led)"Not used while LED detection is off" else if(c.staffColors.isEmpty())"All colors" else "Only ${c.staffColors.joinToString(" + ",transform=::colorName)}",color=if(c.led)Lime else Muted,fontSize=18.sp,fontWeight=FontWeight.Bold)
    FilterChip(selected=c.staffColors.isEmpty(),enabled=c.led,onClick={choose(emptyList())},label={Text("Any / rainbow")})
    staffColorNames.chunked(3).forEach {row->
        Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
            row.forEach {name->
                val selected=name in c.staffColors
                FilterChip(selected=selected,enabled=c.led,onClick={choose(staffColorNames.filter {if(it==name)!selected else it in c.staffColors})},label={Text(colorName(name))},
                    leadingIcon={Box(Modifier.size(14.dp).background(swatches.getValue(name),CircleShape).border(1.dp,Color.Black.copy(alpha=.6f),CircleShape))})
            }
        }
    }
    Text(if(c.led)"Match your staff's current LED setting. Choose one or more colors to ignore other lights; pick two for differently colored staves. White can still match sunlight." else "Color choice applies only to LED detection. Turn on LED staves to use it.",fontSize=14.sp,lineHeight=19.sp,color=Muted)
}
/** Background snapshot: ignores lights that never move. The video stays live during the countdown. */
@Composable fun BackgroundControls(ui:FlowUi,engine:FlowEngine,onError:(String)->Unit) {
    val status=ui.frame?.background ?: BackgroundStatus()
    val live=ui.cameraReady && !ui.demo
    val capturing=status.state=="countdown" || status.state=="capturing"
    fun send(mode:String){try{engine.command(JSONObject().put("action","background").put("mode",mode))}catch(e:Exception){onError(e.message ?: "Background snapshot failed")}}
    Text("Background snapshot",fontSize=16.sp,fontWeight=FontWeight.SemiBold,modifier=Modifier.padding(top=10.dp))
    Text(when{
        !live->"Needs the live camera, not the demo."
        status.state=="countdown"->"Countdown ${max(1L,(status.remainingMs+999)/1000)}: move your staves out of view and keep the phone still."
        status.state=="capturing"->"Capturing. Keep your staves out of view a moment longer."
        status.state=="ready"->"On. Lights that were in the snapshot are ignored. Recapture after moving the phone or changing the lighting."
        else->"Off. Every bright light in view can be mistaken for a staff."
    },fontSize=15.sp,lineHeight=20.sp,color=Ink)
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        if(capturing)OutlinedButton(enabled=live,onClick={send("cancel")}){Text("Cancel capture")}
        else OutlinedButton(enabled=live,onClick={send("capture")}){Text(if(status.state=="ready")"Recapture background" else "Capture background")}
        if(status.state=="ready")TextButton(enabled=live,onClick={send("clear")}){Text("Clear background")}
    }
    Text("Ignore lights that never move, like a window or lamp. After you press Capture, move your staves out of view for 5 seconds and keep the phone still.",fontSize=14.sp,lineHeight=19.sp,color=Muted)
}
