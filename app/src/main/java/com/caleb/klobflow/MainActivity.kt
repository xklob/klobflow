package com.caleb.klobflow

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import kotlin.math.*

val Lime=Color(0xffb6f36b)
val Lavender=Color(0xffb5a3ff)
private val Background=Color(0xff10130f)
private val Muted=Color(0xffa1aa9b)
class MainActivity:ComponentActivity() {
    internal lateinit var engine:FlowEngine
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        engine=FlowEngine(this,this)
        setContent {MaterialTheme(colorScheme=darkColorScheme(primary=Lime,secondary=Lavender,background=Background,surface=Color(0xff1a2018),onPrimary=Background,onBackground=Color(0xfff0f2e9),onSurface=Color(0xfff0f2e9),secondaryContainer=Color(0xff334428),onSecondaryContainer=Lime)) {Surface(Modifier.fillMaxSize(),color=Background,contentColor=MaterialTheme.colorScheme.onBackground){FlowApp(engine)}}}
    }
    override fun onConfigurationChanged(newConfig:android.content.res.Configuration){super.onConfigurationChanged(newConfig);engine.rotationChanged(windowManager.defaultDisplay.rotation)}
    override fun onStart(){super.onStart();engine.foreground()}
    override fun onStop(){super.onStop();engine.background()}
    override fun onDestroy(){engine.close();super.onDestroy()}
}

@Composable fun FlowApp(engine:FlowEngine) {
    val ui by engine.ui.collectAsStateWithLifecycle()
    val context=LocalContext.current
    var page by remember {mutableIntStateOf(0)}
    var message by remember {mutableStateOf<String?>(null)}
    var permission by remember {mutableStateOf(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)}
    val request=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted->permission=granted;if(granted)engine.bindCamera()else message="Camera permission is needed to track your practice. You can still try the demo."}
    fun run(block:()->Unit){try{block()}catch(e:Exception){message=e.message ?: "Action failed"}}
    fun patch(key:String,value:Any)=run{engine.updateConfig(JSONObject().put(key,value))}
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME){permission=ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED}
    Column(Modifier.fillMaxSize().background(Background).safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=15.dp),verticalAlignment=Alignment.CenterVertically) {
            Text("╱╱",color=Lime,fontSize=28.sp,fontWeight=FontWeight.Bold)
            Spacer(Modifier.width(10.dp));Text("klobflow",fontSize=25.sp,fontWeight=FontWeight.SemiBold)
            Spacer(Modifier.weight(1f));Text(if(ui.demo)"DEMO" else "FLOW LAB",color=if(ui.demo)Lavender else Muted,fontSize=11.sp,letterSpacing=2.sp)
        }
        if(message!=null || ui.error!=null) Surface(color=Color(0xff47372b),modifier=Modifier.fillMaxWidth()) {
            Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Text(message ?: ui.error!!,Modifier.weight(1f),fontSize=13.sp);if(message!=null)TextButton(onClick={message=null}){Text("OK")}}
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal=16.dp)) {
            when(page){
                0->{
                    Text("Find your lines.",fontSize=28.sp,fontWeight=FontWeight.Medium)
                    Text(ui.status,color=Muted,fontSize=12.sp,modifier=Modifier.padding(top=5.dp,bottom=12.dp))
                    Row(horizontalArrangement=Arrangement.spacedBy(7.dp)) {listOf("grid" to "Grid","circles" to "Circles","cube" to "Cube","free" to "Free").forEach {(key,label)->FilterChip(selected=ui.config.mode==key,onClick={patch("mode",key)},label={Text(label)})}}
                    Row {listOf(2 to "Two staves",1 to "One staff / one hand").forEach {(count,label)->FilterChip(selected=ui.config.staffCount==count,onClick={patch("staffCount",count)},label={Text(label)},modifier=Modifier.padding(end=6.dp))}}
                    ModeTutorial(ui.config.mode)
                    AlignmentCue(ui)
                    BeatFeedback(ui)
                    CameraPanel(ui,engine){message=it}
                    FitControls(ui,engine)
                    if(ui.cameraReady && ui.zoomMax>ui.zoomMin){
                        var zoomDraft by remember(ui.zoomRatio){mutableFloatStateOf(ui.zoomRatio)}
                        Row(verticalAlignment=Alignment.CenterVertically){Text("Zoom · %.2f×".format(ui.zoomRatio),Modifier.weight(1f),color=Lime,fontSize=13.sp);TextButton(onClick={patch("zoom",0.0)}){Text("Widest")}}
                        Slider(value=zoomDraft.coerceIn(ui.zoomMin,ui.zoomMax),onValueChange={zoomDraft=it},onValueChangeFinished={patch("zoom",zoomDraft.toDouble())},valueRange=ui.zoomMin..ui.zoomMax)
                    }
                    if(!ui.cameraReady && !ui.demo) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Button(onClick={if(permission)run{engine.bindCamera()}else request.launch(Manifest.permission.CAMERA)},modifier=Modifier.weight(1f)){Text(if(permission)"Open camera" else "Allow camera")}
                        OutlinedButton(onClick={engine.startDemo()}){Text("Try demo")}
                    }
                    Row(Modifier.fillMaxWidth().padding(vertical=12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Metric("${if(ui.config.mode=="cube")"Vertex" else if(ui.config.mode=="circles")"Circle" else "Grid"} error",ui.frame?.metrics?.deviation,"%",Modifier.weight(1f),ui.config.tolerance)
                        Metric("Angle error",ui.frame?.metrics?.angle,"°",Modifier.weight(1f))
                        if(ui.config.staffCount==2)Metric("Symmetry",ui.frame?.metrics?.symmetry,"%",Modifier.weight(1f),ui.config.tolerance)
                    }
                    val good=ui.frame?.staffs?.count {it!=null && it.confidence>=0.55} ?: 0
                    val error=ui.frame?.metrics?.deviation
                    Text(if(good==ui.config.staffCount)(if(ui.config.staffCount==1)"● One staff tracked"else"● Both staves tracked")+(if(error==null)"" else if(error<=ui.config.tolerance)" · within target" else " · outside target") else "$good / ${ui.config.staffCount} staves visible · scores pause when uncertain",color=if(good==ui.config.staffCount)Lime else Lavender,fontSize=13.sp)
                    Text("${ui.frame?.analysisFps?.toInt() ?: 0} analysis fps · projected 2D measurements",color=Muted,fontSize=11.sp,modifier=Modifier.padding(top=5.dp,bottom=12.dp))
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Button(onClick={run{if(ui.recording)engine.stopRecording()else engine.startRecording()}},enabled=(ui.cameraReady && !ui.demo && !ui.finalizing),modifier=Modifier.weight(1f),colors=ButtonDefaults.buttonColors(containerColor=if(ui.recording)Color(0xffec9b85)else Lime)) {
                            Text(if(ui.finalizing)"Saving…" else if(ui.recording)"Stop · ${ui.elapsed/1000}s" else "● Record practice")
                        }
                        OutlinedButton(onClick={if(ui.demo){if(permission)run{engine.bindCamera()}else request.launch(Manifest.permission.CAMERA)}else patch("facing",if(ui.config.facing=="front")"back" else "front")},enabled=!ui.recording && !ui.finalizing){Text(if(ui.demo)"Camera" else "Flip")}
                    }
                    Text("Video saves to Movies / Klobflow. Analysis saves with the session. Keep the app in the foreground.",color=Muted,fontSize=12.sp,modifier=Modifier.padding(vertical=10.dp))
                    SharePanel(ui,{run{engine.share(!ui.sharing)}})
                }
                1->{
                    Text("Make the space yours.",fontSize=25.sp)
                    Text("Set the guide to your practice plane. A fixed phone and clear contrast give the most useful feedback.",color=Muted,modifier=Modifier.padding(vertical=10.dp))
                    Label("TRACKING")
                    Toggle("Mirror camera",ui.config.mirror){patch("mirror",it)}
                    Toggle("LED staves",ui.config.led){patch("led",it)}
                    Text(if(ui.config.led)"Detect bright, elongated shapes. No markers required." else "Experimental edge mode for unlit staves.",color=Muted,fontSize=12.sp)
                    ControlSlider("Brightness threshold",ui.config.threshold.toFloat(),60f..250f){patch("threshold",it.toInt())}
                    ControlSlider("Minimum staff length",(ui.config.minLength*100).toFloat(),10f..80f,"%"){patch("minLength",it/100.0)}
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf(30,60).forEach {rate->FilterChip(selected=ui.config.fps==rate,onClick={patch("fps",rate)},label={Text("$rate fps target")})}}
                    Text("60 fps is requested for recording. Camera hardware may choose a lower rate; analysis runs independently at up to 30 fps.",color=Muted,fontSize=12.sp)
                    Label("BEAT TIMING")
                    BeatSettings(ui,engine)
                    Label("GUIDE CALIBRATION")
                    Toggle("Fit center, size and zoom at startup",ui.config.autoFit){patch("autoFit",it)}
                    FitControls(ui,engine)
                    ControlSlider("Center X",(ui.config.cx*100).toFloat(),10f..90f,"%"){patch("cx",it/100.0)}
                    ControlSlider("Center Y",(ui.config.cy*100).toFloat(),10f..90f,"%"){patch("cy",it/100.0)}
                    ControlSlider("Size",(ui.config.scale*100).toFloat(),10f..48f,"%"){patch("scale",it/100.0)}
                    ControlSlider("Rotation",ui.config.rotation.toFloat(),-90f..90f,"°"){patch("rotation",it.toDouble())}
                    if(ui.config.mode=="cube")ControlSlider("Cube projection depth",(ui.config.cubeDepth*100).toFloat(),10f..90f,"%"){patch("cubeDepth",it/100.0)}
                    if(ui.config.mode=="circles")ControlSlider("Circle separation",(ui.config.circleSeparation*100).toFloat(),0f..180f,"%"){patch("circleSeparation",it/100.0)}
                    ControlSlider("Target tolerance",ui.config.tolerance.toFloat(),1f..15f,"%"){patch("tolerance",it.toDouble())}
                    Toggle("Alignment arrows",ui.config.showFeedback){patch("showFeedback",it)}
                    Toggle("Show guide",ui.config.showGuide){patch("showGuide",it)}
                    Toggle("Diagonal grid lines",ui.config.diagonals){patch("diagonals",it)}
                    Toggle("Tip trails",ui.config.trails){patch("trails",it)}
                    if(ui.config.staffCount==2)Toggle("Mirror-symmetry measurement",ui.config.symmetry){patch("symmetry",it)}
                    OutlinedButton(onClick={run{engine.updateConfig(Config().json().put("facing",ui.config.facing).put("fps",ui.config.fps))}}){Text("Reset practice settings")}
                }
                2->{
                    Text("Your practice log.",fontSize=25.sp)
                    Text("Recordings stay on your phone. Export the analysis to inspect every measured frame on your PC.",color=Muted,modifier=Modifier.padding(vertical=12.dp))
                    if(ui.sessions.isEmpty())Text("No sessions yet. Record your first practice from the live view.",Modifier.padding(vertical=32.dp),color=Muted)
                    ui.sessions.forEach {s->
                        Surface(shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().padding(bottom=10.dp)) {
                            Column(Modifier.padding(16.dp)){
                                Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(Date(s.getLong("createdAt"))),fontWeight=FontWeight.Medium)
                                Text("${s.getLong("durationMs")/1000}s · ${s.optInt("validFrames")} scored / ${s.optInt("frames")} samples",color=Muted,fontSize=12.sp)
                                if(!s.isNull("recordingError"))Text("Recording error ${s.optInt("recordingError")}. Check video before relying on it.",color=Lavender,fontSize=12.sp)
                                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                                    TextButton(onClick={run{context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(s.getString("videoUri")),"video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))}}){Text("Play video")}
                                    TextButton(onClick={run{val uri=FileProvider.getUriForFile(context,"${context.packageName}.files",engine.sessionFile(s.getString("id")));context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/x-ndjson").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"Export analysis"))}}){Text("Export analysis")}
                                }
                            }
                        }
                    }
                }
                else->{
                    Text("Practice with intention.",fontSize=25.sp)
                    Text("1. Put the phone on a stable support, with your whole movement in frame. Use the rear camera with the PC companion for a larger practice view.\n\n2. Turn on your LED staves. Avoid bright windows or long lights in the background. Adjust brightness threshold if the app follows the wrong shape.\n\n3. Choose Grid for lines, Circles for radial consistency, or Cube for endpoint alignment with projected vertices. Adjust the guide to your stance. Use Identify staves if automatic selection is wrong.\n\n4. Begin slowly. Missing or ambiguous staves pause the scores. Identical props and endpoints can swap after occlusion.\n\n5. Record, then review your video alongside the exported measurements.",color=Muted,modifier=Modifier.padding(vertical=12.dp))
                    Label("VTG DRILL NOTES")
                    Text("Timing is listed first, direction second. These choices annotate your session; Klobflow does not infer hands, grip, flower ratios, or VTG patterns from staff lines.",color=Muted,fontSize=13.sp)
                    listOf("tog-same" to "Together / same","split-same" to "Split / same","tog-opp" to "Together / opposite","split-opp" to "Split / opposite").forEach {(key,label)->FilterChip(selected=ui.config.timing==key,onClick={patch("timing",key)},label={Text(label)})}
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("1:1","1:3","1:5").forEach {ratio->FilterChip(selected=ui.config.ratio==ratio,onClick={patch("ratio",ratio)},label={Text(ratio)})}}
                    Label("UNDERSTAND THE NUMBERS")
                    Text("Error is RMS endpoint distance as a percentage of the guide's width (circle diameter in Circles). Cube error uses the nearest vertex. Angle error compares staff orientation to guide lines. Symmetry reflects one staff across the guide's center axis. Lower is closer.\n\nSpeed variation compares angular speeds over the last 1.2 seconds. It needs steady, visible motion. Deliberate stalls and transitions can increase it. None of these numbers is an overall skill grade.\n\nA single camera measures projected 2D geometry. The cube is a visual reference, not a measurement of 3D depth.",color=Muted,fontSize=13.sp,modifier=Modifier.padding(vertical=10.dp))
                    TextButton(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://noelyee.com/instruction/vulcan-tech-gospel/")))}){Text("Noel Yee · Vulcan Tech Gospel ↗")}
                    TextButton(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://flowartsinstitute.com/wp-content/uploads/2015/02/VTGpostersmall.jpg")))}){Text("VTG reference poster ↗")}
                    Text("Independent practice tool. No endorsement by VTG or its contributors.",color=Muted,fontSize=11.sp)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
        NavigationBar(containerColor=Background,tonalElevation=0.dp){listOf("Practice","Adjust","Sessions","Guide").forEachIndexed {i,label->NavigationBarItem(selected=page==i,onClick={page=i},icon={Text(listOf("◎","⊞","▤","◇")[i],fontSize=20.sp)},label={Text(label)})}}
    }
}
@Composable private fun CameraPanel(ui:FlowUi,engine:FlowEngine,onError:(String)->Unit) {
    var identifying by remember {mutableStateOf(false)}
    var calibrating by remember {mutableStateOf(false)}
    var planeAspect by remember {mutableStateOf("1.0")}
    var picks by remember {mutableStateOf(emptyList<P>())}
    val trails=remember {mutableStateListOf<Pair<Long,List<Segment?>>>()}
    LaunchedEffect(ui.frame?.time){ui.frame?.let {f->trails.add(f.time to f.staffs);while(trails.isNotEmpty() && (f.time-trails.first().first>4200 || trails.size>135))trails.removeAt(0)}}
    val aspect=ui.bitmap?.let {it.width.toFloat()/it.height} ?: (4f/3f)
    Box(Modifier.fillMaxWidth().aspectRatio(aspect).background(Color(0xff080b08),RoundedCornerShape(16.dp))
        .pointerInput(identifying,calibrating,ui.config.staffCount,planeAspect,ui.frame?.width,ui.frame?.height){if(identifying || calibrating)detectTapGestures {pos->
            picks=picks+P((pos.x/size.width).toDouble(),(pos.y/size.height).toDouble())
            if(picks.size==(if(calibrating)4 else ui.config.staffCount*2)){try{if(calibrating)engine.command(JSONObject().put("action","calibrate").put("points",JSONArray(picks.map {it.json()})).put("aspect",planeAspect.toDouble()))else engine.seed(picks)}catch(e:Exception){onError(e.message ?: "Could not apply selection")};picks=emptyList();identifying=false;calibrating=false}
        }}) {
        ui.bitmap?.let {Image(it.asImageBitmap(),"Live practice camera",Modifier.fillMaxSize())}
        if(ui.bitmap==null)Text("A little space. Two staves.\nYour next practice starts here.",Modifier.align(Alignment.Center).padding(20.dp),color=Muted)
        Canvas(Modifier.fillMaxSize()) {
            val f=ui.frame ?: return@Canvas
            val g=f.guide
            val unit=min(size.width/g.aspectX.toFloat(),size.height/g.aspectY.toFloat())
            fun p(v:P)=Offset((v.x*unit).toFloat(),(v.y*unit).toFloat())
            if(ui.config.showGuide){
                g.displayLines.forEach {drawLine(Color.White.copy(alpha=0.38f),p(it.a),p(it.b),1.5f,pathEffect=PathEffect.dashPathEffect(floatArrayOf(7f,7f)))}
                g.circlePaths.forEach {path->path.zipWithNext().forEach {(a,b)->drawLine(Color.White.copy(alpha=0.4f),p(a),p(b),1.5f)}}
                if(ui.config.mode in listOf("grid","cube"))g.displayVertices.forEach {drawCircle(Lime.copy(alpha=0.65f),3f,p(it))}
            }
            if(ui.config.trails)trails.forEachIndexed {index,entry->entry.second.forEachIndexed {i,s->if(s!=null && s.confidence>=0.55)listOf(s.a,s.b).forEach {drawCircle((if(i==0)Lime else Lavender).copy(alpha=(1.5f*(index+1)/trails.size).coerceAtMost(1f)),3.5f,p(it))}}}
            f.staffs.forEachIndexed {i,s->if(s!=null){val col=(if(i==0)Lime else Lavender).copy(alpha=if(s.confidence>=0.55)1f else 0.35f);drawLine(col,p(s.a),p(s.b),4f);drawCircle(col,6f,p(s.a),style=Stroke(2f));drawCircle(col,6f,p(s.b),style=Stroke(2f))}}
            if(ui.config.showFeedback)g.cues(f.staffs).forEach {cue->
                val from=p(cue.tip);val to=p(cue.target);val col=if(cue.onTarget)Lime else Color(0xffffb45e)
                drawCircle(col,10f,from,style=Stroke(3f))
                if(!cue.onTarget){
                    drawLine(Color.Black.copy(alpha=0.8f),from,to,6f)
                    drawLine(col,from,to,3f)
                    val a=atan2(to.y-from.y,to.x-from.x)
                    listOf(-0.5f,0.5f).forEach {d->drawLine(col,to,Offset(to.x-12*cos(a+d),to.y-12*sin(a+d)),3f)}
                    drawCircle(Color.White,5f,to,style=Stroke(2f))
                }
            }
            if(f.beat.enabled){
                val textPaint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {color=android.graphics.Color.WHITE;textSize=12f}
                f.beat.targets.forEachIndexed {i,points->points.forEachIndexed {j,target->val pos=p(target);drawCircle(if(i==0)Color(0xff6dd8ff)else Lavender,if(f.beat.phase<.18)10f else 7f,pos,style=Stroke(if(f.beat.phase<.18)4f else 2f));drawContext.canvas.nativeCanvas.drawText("${j+1}",pos.x+10,pos.y-9,textPaint)}}
                f.staffs.forEach {s->if(s!=null && s.confidence>=.55)drawCircle(Color.White,3f,p(s.a))}
            }
            picks.forEach {drawCircle(Color.White,7f,Offset((it.x*size.width).toFloat(),(it.y*size.height).toFloat()),style=Stroke(2f))}
        }
        if(ui.demo)Text("SYNTHETIC DEMO",Modifier.align(Alignment.TopStart).padding(12.dp).background(Background).padding(6.dp),color=Lavender,fontSize=11.sp)
        if(calibrating)Text("Tap "+listOf("top left","top right","bottom right","bottom left")[picks.size],Modifier.align(Alignment.TopCenter).background(Background).padding(8.dp),color=Lime)
        if(identifying)Text("Tap ${if(picks.size<2)"staff A" else "staff B"}, end ${picks.size%2+1}",Modifier.align(Alignment.TopCenter).background(Background).padding(8.dp),color=Lime)
    }
    Text("Lime / purple = staves · white = guide\nGreen rings = on target · orange arrows = move tips toward targets",color=Muted,fontSize=11.sp,modifier=Modifier.padding(top=8.dp))
    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
        TextButton(onClick={identifying=!identifying;calibrating=false;picks=emptyList()},enabled=ui.frame!=null){Text(if(identifying)"Cancel" else "Identify staves")}
        TextButton(onClick={engine.resetTracking();trails.clear()}){Text("Reacquire")}
    }
    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
        TextButton(onClick={calibrating=!calibrating;identifying=false;picks=emptyList()},enabled=ui.frame!=null){Text(if(calibrating)"Cancel calibration" else "Calibrate angle")}
        if(ui.config.planeCorners.isNotEmpty())TextButton(onClick={engine.updateConfig(JSONObject().put("planeCorners",JSONArray()))}){Text("Clear angle")}
    }
    if(calibrating){
        Text("Mark a rectangle in your movement plane, clockwise from top left. Use a square for 1:1. Keep the phone fixed.",color=Muted,fontSize=12.sp)
        OutlinedTextField(value=planeAspect,onValueChange={planeAspect=it},label={Text("Rectangle width ÷ height (0.25–4)")},singleLine=true,modifier=Modifier.fillMaxWidth())
    } else if(ui.config.planeCorners.isNotEmpty()){
        Text("Angle corrected in the calibrated plane. Recalibrate after moving the phone. Zoom, camera, or orientation changes clear calibration.",color=Lime,fontSize=12.sp)
    }
}
@Composable private fun AlignmentCue(ui:FlowUi) {
    val f=ui.frame
    val cues=f?.guide?.cues(f.staffs).orEmpty()
    val good=f?.staffs?.count {it!=null && it.confidence>=0.55} ?: 0
    val count=ui.config.staffCount
    val aligned=cues.size==count*2 && cues.all {it.onTarget}
    val hidden=f?.staffs?.any {it?.occluded==true}==true
    val title=when {hidden->"Tip hidden · keeping staff identity";good<count->if(count==1)"Keep the staff visible"else"Keep both staves visible";ui.config.mode=="free"->"Free flow · no alignment target";cues.isEmpty()->"Move inside the calibrated plane";aligned->"✓ Tips on guide";else->"Adjust highlighted tips"}
    val detail=when {hidden->"Continue your movement. Precision scores wait for visible tips; tracking reconnects when the tip returns.";good<count->"$good / $count staves tracked. Alignment cues pause until tips are clear.";ui.config.mode=="free"->"Choose Grid, Circles, or Cube for alignment cues.";cues.isEmpty()->"Keep all tips inside your calibration rectangle.";aligned->"All ${count*2} tips are within the ${ui.config.tolerance.toInt()}% target. Keep tracing the guide.";else->"${cues.count {!it.onTarget}} / ${count*2} tips outside target. Follow orange arrows toward white rings."}
    Surface(color=if(aligned)Color(0xff263e1d)else if(cues.isNotEmpty())Color(0xff42301b)else Color(0xff242830),shape=RoundedCornerShape(12.dp),modifier=Modifier.fillMaxWidth().padding(bottom=10.dp)){
        Column(Modifier.padding(14.dp)){Text(title,fontSize=19.sp,fontWeight=FontWeight.SemiBold,color=if(aligned)Lime else if(cues.isNotEmpty())Color(0xffffbd77)else Lavender);Text(detail,fontSize=12.sp,modifier=Modifier.padding(top=4.dp))}
    }
}
@Composable private fun Metric(label:String,value:Double?,suffix:String,modifier:Modifier,target:Double?=null) {
    Surface(shape=RoundedCornerShape(12.dp),modifier=modifier){Column(Modifier.padding(10.dp)){
        Text(label,color=Muted,fontSize=10.sp)
        Text(value?.let {"%.1f%s".format(it,suffix)} ?: "—",fontSize=23.sp,color=if(value==null)Muted else if(target!=null && value>target)Color(0xffedc293) else Lime)
    }}
}
@Composable private fun SharePanel(ui:FlowUi,toggle:()->Unit) {
    Surface(shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){
        Row(verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("A bigger practice space",fontWeight=FontWeight.Medium);Text("Connect your PC by USB or Wi-Fi / LAN",color=Muted,fontSize=12.sp)};Switch(ui.sharing,onCheckedChange={toggle()})}
        if(ui.sharing){
            Text(ui.addresses.joinToString("\n").ifBlank {"No LAN address found. Connect to Wi-Fi."},color=Lime,fontSize=16.sp)
            Text("Open localhost:8788 on the PC. Choose USB cable, or enter this Wi-Fi address. No pairing code. Anyone on your LAN can connect while sharing is on. Sharing pauses when you leave and resumes when you reopen.",color=Muted,fontSize=12.sp)
        }
    }}
}
@Composable private fun Label(text:String){Text(text,color=Lime,fontSize=11.sp,letterSpacing=2.sp,modifier=Modifier.padding(top=24.dp,bottom=8.dp))}
@Composable private fun Toggle(label:String,value:Boolean,changed:(Boolean)->Unit){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(label,Modifier.weight(1f),fontSize=14.sp);Switch(value,changed)}}
@Composable private fun ControlSlider(label:String,value:Float,range:ClosedFloatingPointRange<Float>,unit:String="",changed:(Float)->Unit) {
    var draft by remember(value){mutableFloatStateOf(value)}
    Row(Modifier.fillMaxWidth().padding(top=12.dp)){Text(label,Modifier.weight(1f),fontSize=13.sp);Text("${draft.toInt()}$unit",color=Lime,fontSize=13.sp)}
    Slider(value=draft,onValueChange={draft=it},onValueChangeFinished={changed(draft)},valueRange=range)
}
