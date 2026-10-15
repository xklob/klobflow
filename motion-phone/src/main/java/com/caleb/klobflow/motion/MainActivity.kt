package com.caleb.klobflow.motion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.util.Locale

// Palette from motion/public/style.css so the phone and Motion Lab read as one product.
private val Bg=Color(0xff0b1017)
private val PanelBg=Color(0xff141c27)
private val Raised=Color(0xff1c2736)
private val Line=Color(0xff2c3849)
private val Ink=Color(0xfff1f5fc)
private val Muted=Color(0xffaebbcf)
private val Mint=Color(0xff8becd0)
private val OnMint=Color(0xff0b2c24)
private val StageBg=Color(0xff080b10)
private val Calm=Color(0xfff3dcae)
private val CalmBg=Color(0xff221d14)
private val CalmLine=Color(0x80d9b26a)

class MainActivity:ComponentActivity() {
    private lateinit var host:CameraHost
    private var permitted by mutableStateOf(false)
    private var declined by mutableStateOf(false)
    private val request=registerForActivityResult(ActivityResultContracts.RequestPermission()){granted->
        permitted=granted;declined=!granted
        // Usually delivered while paused behind the system dialog, so onResume binds; retry() covers a late result.
        if(granted)host.retry()
    }
    override fun onCreate(savedInstanceState:Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        window.decorView.setBackgroundColor(0xff0b1017.toInt())
        host=CameraHost(this)
        // TextureView mode: CameraHost mirrors with scaleX, and only TextureView honours view transforms and clipping.
        val preview=PreviewView(this).apply{implementationMode=PreviewView.ImplementationMode.COMPATIBLE;scaleType=PreviewView.ScaleType.FIT_CENTER;setBackgroundColor(0xff080b10.toInt())}
        host.attach(preview,this)
        permitted=hasCamera()
        setContent{MaterialTheme(colorScheme=darkColorScheme(primary=Mint,onPrimary=OnMint,background=Bg,onBackground=Ink,surface=PanelBg,onSurface=Ink,surfaceVariant=Raised,onSurfaceVariant=Muted,outline=Line)){
            MotionScreen(host,preview,permitted,declined,{request.launch(Manifest.permission.CAMERA)},::openSettings)
        }}
    }
    override fun onResume(){super.onResume();permitted=hasCamera();host.resume()}
    override fun onPause(){host.pause();super.onPause()}
    override fun onDestroy(){host.close();super.onDestroy()}
    private fun hasCamera()=ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED
    private fun openSettings()=startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.fromParts("package",packageName,null)))
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable private fun MotionScreen(host:CameraHost,preview:PreviewView,permitted:Boolean,declined:Boolean,allow:()->Unit,settings:()->Unit) {
    val state by host.state.collectAsStateWithLifecycle()
    val view=LocalView.current
    // Stay awake only while live camera frames are on screen.
    DisposableEffect(view,state.ready){view.keepScreenOn=state.ready;onDispose{view.keepScreenOn=false}}
    // The one attached PreviewView moves between layouts on rotation instead of being recreated.
    val camera=remember(preview){movableContentOf{AndroidView(factory={preview},modifier=Modifier.fillMaxSize())}}
    BoxWithConstraints(Modifier.fillMaxSize().background(Bg).safeDrawingPadding().padding(horizontal=16.dp).semantics{testTagsAsResourceId=true}) {
        val wide=maxWidth>maxHeight
        Column(Modifier.fillMaxSize()) {
            Header(state,wide)
            if(wide)Row(Modifier.fillMaxWidth().weight(1f).padding(bottom=12.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) {
                Stage(state,permitted,camera,Modifier.weight(.58f).fillMaxHeight())
                Controls(state,host,permitted,declined,allow,settings,Modifier.weight(.42f).fillMaxHeight())
            } else {
                Stage(state,permitted,camera,Modifier.fillMaxWidth().weight(.58f))
                Spacer(Modifier.height(14.dp))
                Controls(state,host,permitted,declined,allow,settings,Modifier.fillMaxWidth().weight(.42f))
            }
        }
    }
}

@Composable private fun Header(state:CaptureState,wide:Boolean) {
    Row(Modifier.fillMaxWidth().padding(vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(16.dp),verticalAlignment=Alignment.CenterVertically) {
        Column(Modifier.semantics(mergeDescendants=true){heading()}) {
            Text(buildAnnotatedString{append("klob");withStyle(SpanStyle(color=Mint)){append("flow")}},color=Color.White,fontSize=28.sp,fontWeight=FontWeight.ExtraBold,letterSpacing=(-1).sp,lineHeight=30.sp)
            Text("MOTION LAB",color=Muted,fontSize=11.sp,letterSpacing=3.sp,fontWeight=FontWeight.SemiBold)
        }
        if(wide)PcNote(Modifier.weight(1f)) else Spacer(Modifier.weight(1f))
        val live=state.sharing
        Text(if(live)"Sharing on" else if(state.ready)"Preview only" else "Camera off",
            Modifier.border(1.dp,if(live)Mint else Line,RoundedCornerShape(30.dp)).background(PanelBg,RoundedCornerShape(30.dp)).padding(horizontal=14.dp,vertical=6.dp),
            color=if(live)Mint else Muted,fontSize=15.sp)
    }
    if(!wide)PcNote(Modifier.fillMaxWidth().padding(bottom=12.dp))
}

@Composable private fun PcNote(modifier:Modifier)=Text("Tracking runs in Motion Lab on your PC in this prototype.",
    modifier.border(1.dp,Mint.copy(alpha=.4f),RoundedCornerShape(12.dp)).background(Color(0xff092720),RoundedCornerShape(12.dp)).padding(horizontal=14.dp,vertical=8.dp),
    color=Color(0xffd8fff2),fontSize=17.sp,lineHeight=22.sp)

@Composable private fun Stage(state:CaptureState,permitted:Boolean,camera:@Composable ()->Unit,modifier:Modifier) {
    val shape=RoundedCornerShape(16.dp)
    Box(modifier.clip(shape).background(StageBg).border(1.dp,Line,shape).testTag("preview").semantics{contentDescription="Mirrored live camera preview"}) {
        camera()
        if(!state.ready)Column(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0x55193d3d),Color.Transparent))).padding(24.dp),Arrangement.Center,Alignment.CenterHorizontally) {
            Text("◎",color=Mint.copy(alpha=.65f),fontSize=56.sp)
            Text(when{!permitted->"Camera access needed";state.error!=null->"Camera unavailable";else->"Starting camera…"},Modifier.padding(top=12.dp,bottom=6.dp),color=Ink,fontSize=24.sp,fontWeight=FontWeight.Bold,textAlign=TextAlign.Center)
            Text(when{!permitted->"Allow the camera below to see yourself here.";state.error!=null->"Details and Try again are below.";else->"The preview appears here in a moment."},color=Muted,fontSize=17.sp,textAlign=TextAlign.Center)
        }
        Row(Modifier.fillMaxWidth().padding(12.dp)){Tag("MIRRORED PREVIEW",Ink);Spacer(Modifier.weight(1f));if(state.sharing)Tag("● SHARING",Mint)}
        Text(if(state.ready)"${decimal(state.fps)} fps measured · ${state.requestedFps} fps requested" else "No camera frames",
            Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent,Color(0xd9080b10)))).padding(horizontal=16.dp,vertical=10.dp),
            color=Ink,fontSize=15.sp)
    }
}

@Composable private fun Tag(text:String,color:Color)=Text(text,Modifier.background(Color(0xc90b1017),RoundedCornerShape(8.dp)).padding(horizontal=10.dp,vertical=4.dp),
    color=color,fontSize=12.sp,letterSpacing=1.5.sp,fontWeight=FontWeight.SemiBold)

@Composable private fun Controls(state:CaptureState,host:CameraHost,permitted:Boolean,declined:Boolean,allow:()->Unit,settings:()->Unit,modifier:Modifier) {
    // Status and sharing come first and the whole column scrolls, so neither is ever pushed off screen.
    Column(modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        if(!state.ready || state.error!=null || !permitted)Status(state,host,permitted,declined,allow,settings)
        Sharing(state,host)
        CameraControls(state,host)
        Connect(state)
        Text("Experimental rewrite · Camera source only · Nothing is recorded on this phone",Modifier.fillMaxWidth().padding(vertical=8.dp),color=Muted,fontSize=13.sp,textAlign=TextAlign.Center)
    }
}

@Composable private fun Status(state:CaptureState,host:CameraHost,permitted:Boolean,declined:Boolean,allow:()->Unit,settings:()->Unit) {
    when {
        !permitted->Section("CAMERA ACCESS","Allow the camera to begin") {
            Body("The camera feeds this live preview and, only while you share, Motion Lab on your PC. Nothing is recorded.")
            Action("Allow camera","allowCamera",true,onClick=allow)
            if(declined){Body("If Android stops asking, turn on Camera in this app's settings.");Action("Open app settings","openSettings",false,onClick=settings)}
        }
        state.error!=null->Section("CAMERA STATUS","Camera needs attention",CalmLine,CalmBg) {
            Body(state.error.orEmpty(),Calm)
            Body("Try again below. If it keeps failing, close other camera apps or reopen Klobflow. Sharing restarts by itself if it was on.")
            Action("Try again","retry",true){host.retry()}
        }
        state.ready->Section("CAMERA STATUS","Camera ready"){Body(state.message)}
        else->Section("CAMERA STATUS","Starting camera…") {
            Body("The camera is opening. If the preview does not appear, try again.")
            Action("Try again","retry",false){host.retry()}
        }
    }
}

@Composable private fun Sharing(state:CaptureState,host:CameraHost) {
    Section("SHARING",if(state.sharing)"Sharing with your PC" else "Sharing is off",if(state.sharing)Mint.copy(alpha=.5f) else Line) {
        if(state.sharing)Action("Stop sharing","sharing",false){host.sharing(false)}
        else Action("Start sharing","sharing",true,enabled=state.ready){host.sharing(true)}
        Body(when {
            state.sharing->"Keep this app on screen. Sharing resumes when you return. Anyone on this LAN can view while sharing is on."
            state.ready->"Share when you are ready to connect from Motion Lab on your PC."
            else->"Sharing becomes available once the camera is running."
        })
    }
}

@Composable private fun Connect(state:CaptureState) {
    Section("CONNECT","Connect from Motion Lab on your PC") {
        Body("On the PC, Motion Lab runs at localhost:8789 in the browser. That is the PC app's address, not this phone's.",Ink)
        Text("USB cable",color=Ink,fontSize=18.sp,fontWeight=FontWeight.SemiBold)
        Body("1. Connect this phone by USB, turn on USB debugging, and allow the PC when asked.\n2. Start sharing here.\n3. In Motion Lab, choose Phone · USB.")
        Text("Wi-Fi",color=Ink,fontSize=18.sp,fontWeight=FontWeight.SemiBold)
        Body("1. Join the same Wi-Fi network on both devices.\n2. Start sharing here.\n3. In Motion Lab, choose Phone · Wi-Fi and enter this phone's address:")
        when {
            !state.sharing->Body("This phone's address appears here after you start sharing.")
            state.addresses.isEmpty()->Body("No network address found. Join Wi-Fi, then stop and start sharing again, or use USB.",Calm)
            else->SelectionContainer{Column(Modifier.testTag("addresses")){state.addresses.forEach{Text(it,color=Mint,fontSize=24.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.Bold)}}}
        }
    }
}

@Composable private fun CameraControls(state:CaptureState,host:CameraHost) {
    var dragging by remember{mutableStateOf<Float?>(null)}
    Section("CAMERA",if(state.front)"Front camera" else "Back camera") {
        Action(if(state.front)"Switch to back camera" else "Switch to front camera","switchCamera",false){host.switchCamera()}
        Row(verticalAlignment=Alignment.CenterVertically) {
            Text("Zoom",color=Ink,fontSize=18.sp,fontWeight=FontWeight.SemiBold);Spacer(Modifier.weight(1f))
            Text("${decimal(state.zoom)}× actual",color=Mint,fontSize=22.sp,fontWeight=FontWeight.Bold)
        }
        if(state.zoomMax>state.zoomMin+.01f) {
            Slider(value=dragging?:state.zoom.coerceIn(state.zoomMin,state.zoomMax),onValueChange={dragging=it;host.zoom(it)},
                modifier=Modifier.fillMaxWidth().testTag("zoom").semantics{contentDescription="Zoom"},enabled=state.ready,
                onValueChangeFinished={dragging=null},valueRange=state.zoomMin..state.zoomMax)
            Body("This camera reports ${decimal(state.zoomMin)}× to ${decimal(state.zoomMax)}×.")
        } else Body("This camera reports a fixed zoom.")
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Stat("MEASURED FPS",if(state.ready)decimal(state.fps) else "–",Modifier.weight(1f))
            Stat("REQUESTED FPS","${state.requestedFps}",Modifier.weight(1f))
        }
        Body("Measured counts frames that actually reach the phone. Low light can make the camera deliver fewer than requested.")
        Body("The preview here is mirrored. Frames sent to Motion Lab are not; it has its own mirror option.")
        Body(state.lensCorrection)
    }
}

@Composable private fun Section(eyebrow:String,title:String,line:Color=Line,fill:Color=PanelBg,content:@Composable ColumnScope.()->Unit) {
    Column(Modifier.fillMaxWidth().border(1.dp,line,RoundedCornerShape(14.dp)).background(fill,RoundedCornerShape(14.dp)).padding(18.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text(eyebrow,color=Muted,fontSize=13.sp,letterSpacing=2.sp,fontWeight=FontWeight.Bold)
        Text(title,Modifier.semantics{heading()},color=Ink,fontSize=22.sp,fontWeight=FontWeight.Bold,lineHeight=27.sp)
        content()
    }
}

@Composable private fun Body(text:String,color:Color=Muted)=Text(text,color=color,fontSize=17.sp,lineHeight=24.sp)

@Composable private fun Action(text:String,tag:String,primary:Boolean,enabled:Boolean=true,onClick:()->Unit) {
    val modifier=Modifier.fillMaxWidth().heightIn(min=54.dp).testTag(tag)
    val shape=RoundedCornerShape(10.dp)
    if(primary)Button(onClick,modifier,enabled=enabled,shape=shape,colors=ButtonDefaults.buttonColors(containerColor=Mint,contentColor=OnMint)){Text(text,fontSize=18.sp,fontWeight=FontWeight.Bold)}
    else OutlinedButton(onClick,modifier,enabled=enabled,shape=shape,border=BorderStroke(1.dp,Line),colors=ButtonDefaults.outlinedButtonColors(containerColor=Raised,contentColor=Ink)){Text(text,fontSize=18.sp,fontWeight=FontWeight.Bold)}
}

@Composable private fun Stat(label:String,value:String,modifier:Modifier) {
    Column(modifier.semantics(mergeDescendants=true){}.border(1.dp,Line,RoundedCornerShape(12.dp)).background(Raised,RoundedCornerShape(12.dp)).padding(14.dp)) {
        Text(label,color=Muted,fontSize=12.sp,letterSpacing=1.5.sp,fontWeight=FontWeight.Bold)
        Text(value,color=Ink,fontSize=30.sp,fontWeight=FontWeight.Bold)
    }
}

private fun decimal(value:Number)=String.format(Locale.US,"%.1f",value.toDouble())
