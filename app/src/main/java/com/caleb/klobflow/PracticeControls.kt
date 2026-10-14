package com.caleb.klobflow

import android.content.Context
import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import kotlin.math.*

@Composable fun ModeTutorial(mode:String) {
    val context=LocalContext.current
    val prefs=remember {context.getSharedPreferences("tutorials",Context.MODE_PRIVATE)}
    val guides=remember {JSONObject(context.assets.open("practice-guides.json").bufferedReader().use {it.readText()})}
    val guide=guides.getJSONObject(mode);val steps=guide.getJSONArray("steps")
    var dismissed by remember(mode){mutableStateOf(prefs.getBoolean(mode,false))}
    var expanded by remember(mode){mutableStateOf(false)}
    if(!dismissed)Surface(color=Color(0xff223126),modifier=Modifier.fillMaxWidth().padding(bottom=8.dp)) {
        Column(Modifier.padding(10.dp)){
            Text(guide.getString("title"),color=Lime)
            Text(steps.getString(0),fontSize=12.sp)
            Row {TextButton(onClick={expanded=true}){Text("Setup tutorial")};TextButton(onClick={dismissed=true;prefs.edit().putBoolean(mode,true).apply()}){Text("Got it")}}
        }
    } else TextButton(onClick={expanded=true}){Text("Show mode tutorial")}
    if(expanded)AlertDialog(onDismissRequest={expanded=false},title={Text(guide.getString("title"))},text={Column(Modifier.verticalScroll(rememberScrollState())){repeat(steps.length()){Text("${it+1}. ${steps.getString(it)}",Modifier.padding(bottom=12.dp))}}},confirmButton={TextButton(onClick={expanded=false;dismissed=true;prefs.edit().putBoolean(mode,true).apply()}){Text("Got it")}})
}
@Composable fun FitControls(ui:FlowUi,engine:FlowEngine) {
    Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
        TextButton(enabled=ui.frame!=null,onClick={engine.command(JSONObject().put("action","fit"))}){Text("Fit center & size")}
        TextButton(enabled=ui.frame!=null,onClick={engine.command(JSONObject().put("action","fit").put("sizeOnly",true))}){Text("Match staff length")}
    }
    Text(ui.frame?.fitStatus.orEmpty(),fontSize=12.sp,color=Lavender)
    val lengths=ui.frame?.let {f->f.staffs.take(ui.config.staffCount).mapNotNull {s->s?.takeIf {it.confidence>=.7 && !it.occluded}?.let(f.guide::rectify)?.length}}.orEmpty()
    if(lengths.isNotEmpty())Text("Guide width / staff length: %.2f×. Match staff length sets 1×; adjust Size for your pattern.".format(ui.config.scale*2/lengths.average()),fontSize=11.sp,modifier=Modifier.padding(bottom=8.dp))
}
@Composable fun BeatSettings(ui:FlowUi,engine:FlowEngine) {
    AudioControls(ui,engine)
    var bpm by remember(ui.config.bpm){mutableStateOf(ui.config.bpm.roundToInt().toString())}
    var taps by remember {mutableStateOf(emptyList<Long>())}
    Row {Text("Beat practice",Modifier.weight(1f));Switch(ui.config.tempoEnabled,onCheckedChange={engine.updateConfig(JSONObject().put("tempoEnabled",it))})}
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        OutlinedTextField(value=bpm,onValueChange={bpm=it.filter(Char::isDigit).take(3)},label={Text("BPM (30–240)")},singleLine=true,modifier=Modifier.weight(1f))
        Button(enabled=bpm.toIntOrNull() in 30..240,onClick={engine.updateConfig(JSONObject().put("bpm",bpm.toInt()).put("tempoEnabled",true).put("tempoSource","manual"))}){Text("Set")}
    }
    Row {listOf(2,4,8).forEach {n->FilterChip(selected=ui.config.beatPoints==n,onClick={engine.updateConfig(JSONObject().put("beatPoints",n))},label={Text("$n points")},modifier=Modifier.padding(end=6.dp))}}
    Row {
        TextButton(enabled=ui.config.tempoSource=="manual",onClick={engine.command(JSONObject().put("action","syncBeat"))}){Text("Start beat now")}
        TextButton(onClick={val now=SystemClock.elapsedRealtime();taps=if(taps.isEmpty() || now-taps.last()>2000)listOf(now)else (taps+now).takeLast(6);if(taps.size>1){val tempo=(60000.0*(taps.size-1)/(now-taps.first())).roundToInt().coerceIn(30,240);engine.updateConfig(JSONObject().put("bpm",tempo).put("tempoEnabled",true).put("tempoSource","manual"));engine.command(JSONObject().put("action","syncBeat"))}}){Text("Tap tempo")}
    }
    Text("Pass numbered points on the pulse. A filled tip marks the measured end. Timing and distance are separate. Start beat now aligns the pulse to your first beat.",fontSize=12.sp)
}
@Composable fun BeatFeedback(ui:FlowUi) {
    val beat=ui.frame?.beat ?: return
    if(!beat.enabled){
        if(ui.config.tempoEnabled && ui.config.tempoSource!="manual")Surface(color=Color(0xff1b3039),modifier=Modifier.fillMaxWidth().padding(vertical=8.dp)){
            Column(Modifier.padding(12.dp)){Text("Beat timing paused",color=Lavender);Text(if(ui.frame!!.audio.status.contains("Following"))"Waiting for fresh audio timing"else ui.frame!!.audio.status,fontSize=12.sp)}
        }
        return
    }
    Surface(color=if(beat.phase<.18)Color(0xff24566b)else Color(0xff1b3039),modifier=Modifier.fillMaxWidth().padding(vertical=8.dp)){
        Column(Modifier.padding(12.dp)){
            Text("${beat.bpm.roundToInt()} BPM · ${if(beat.phase<.18)"BEAT"else"next pulse…"}",color=Color(0xff6dd8ff))
            beat.hits.forEachIndexed {i,hit->
                val text=if(hit==null)"${if(i==0)"A"else"B"} · waiting for a visible tip to pass a point" else {
                    val timing=if(abs(hit.offsetMs)<=75)"On beat" else "${abs(hit.offsetMs).roundToInt()} ms ${if(hit.offsetMs<0)"early"else"late"}"
                    "${if(i==0)"A"else"B"} · point ${hit.point}: $timing · %.1f%% from point".format(hit.error)
                }
                Text(text,fontSize=12.sp,color=if(hit!=null && abs(hit.offsetMs)<=75 && hit.error<=ui.config.tolerance)Lime else Color.White)
            }
        }
    }
}

@Composable fun AudioControls(ui:FlowUi,engine:FlowEngine) {
    val phone by PhoneAudio.state.collectAsStateWithLifecycle()
    val state=if(ui.config.tempoSource=="phone")phone else ui.frame?.audio ?: AudioTempo()
    Text("Tempo source",color=Lime,modifier=Modifier.padding(top=12.dp))
    Row {
        TextButton(onClick={engine.command(JSONObject().put("action","audioStart"))}){Text(if(phone.running)"Use phone audio"else"Connect system audio")}
        TextButton(onClick={engine.command(JSONObject().put("action","audioStop"))}){Text("Use manual / stop")}
    }
    Text(if(ui.config.tempoSource=="manual")"Manual BPM"else if(state.usable(SystemClock.elapsedRealtime().toDouble()))"${if(ui.config.tempoSource=="phone")"Phone"else"PC"} audio · ${(state.bpm!!*ui.config.audioRate).roundToInt()} BPM · ${(state.confidence*100).roundToInt()}% confidence"else if(state.status.contains("Following"))"Waiting for fresh audio timing"else state.status,fontSize=12.sp,color=Lavender)
    Row {listOf(.5 to "Half",1.0 to "Detected",2.0 to "Double").forEach {(rate,label)->FilterChip(selected=ui.config.audioRate==rate,onClick={engine.updateConfig(JSONObject().put("audioRate",rate))},label={Text(label)},modifier=Modifier.padding(end=6.dp))}}
    var offset by remember(ui.config.audioOffsetMs){mutableFloatStateOf(ui.config.audioOffsetMs.toFloat())}
    Text("Audio offset: ${offset.toInt()} ms (positive = later)",fontSize=12.sp)
    Slider(value=offset,onValueChange={offset=it},onValueChangeFinished={engine.updateConfig(JSONObject().put("audioOffsetMs",offset.toDouble()))},valueRange=-500f..500f)
    Text("Approve Android's sharing prompt. The source app must allow playback capture. To follow PC music, choose Use PC system audio in the companion. Silence or uncertain tempo pauses beat feedback. Audio stays local and is not recorded.",fontSize=12.sp)
}
