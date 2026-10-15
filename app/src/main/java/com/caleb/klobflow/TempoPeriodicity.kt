package com.caleb.klobflow

import kotlin.math.*

/** Repetition in the complete activation envelope survives echoes and flutter within one beat. */
class TempoPeriodicity {
    data class Estimate(val bpm: Double, val origin: Double, val confidence: Double)
    private data class Frame(val time: Double,val value: Double)
    private val frames=ArrayDeque<Frame>()
    private var lastFit=Double.NEGATIVE_INFINITY
    var estimate: Estimate?=null; private set
    val historySeconds: Double get()=if(frames.size<2)0.0 else (frames.last().time-frames.first().time).coerceIn(0.0,8.0)
    fun reset() { frames.clear(); estimate=null; lastFit=Double.NEGATIVE_INFINITY }

    fun observe(time: Double,value: Double) {
        frames.addLast(Frame(time,value.coerceIn(0.0,1.0)))
        while (frames.isNotEmpty() && time-frames.first().time>8.0+1e-6) frames.removeFirst()
        if (time-lastFit<.24-1e-6) return
        lastFit=time
        estimate=fit()
    }

    private fun fit(): Estimate? {
        if (frames.size<120) return null
        val samples=frames.toList()
        val span=samples.last().time-samples.first().time
        val step=span/(samples.size-1)
        if (step !in .015..0.025) return null
        val mean=samples.sumOf { it.value }/samples.size
        val values=DoubleArray(samples.size) { samples[it].value-mean }
        if (values.sumOf { it*it }/values.size<.0004) return null
        // A constant tone's initial normalization ramp can correlate with itself for seconds.
        // Require variation in the latest 1.2 seconds too, before trusting or holding that tempo.
        val recent=samples.takeLast(60)
        val recentMean=recent.sumOf {it.value}/recent.size
        if(recent.sumOf {(it.value-recentMean).pow(2)}/recent.size<.0004)return null
        val maximum=min((3.05/step).toInt()+2,values.size/2)
        val correlation=DoubleArray(maximum+1)
        for (lag in 1..maximum) {
            var product=0.0; var left=0.0; var right=0.0
            for (i in lag until values.size) {
                val a=values[i]; val b=values[i-lag]
                product+=a*b; left+=a*a; right+=b*b
            }
            correlation[lag]=product/sqrt(max(1e-12,left*right))
        }
        fun at(lag: Double): Double? {
            val n=lag.toInt()
            if (n<2 || n+2>maximum) return null
            val d=lag-n
            val a=correlation[n-1]; val b=correlation[n]; val c=correlation[n+1]; val e=correlation[n+2]
            // Sub-frame interpolation avoids snapping 174 BPM to the nearest 20 ms lag (176.5).
            return (.5*(2*b+(c-a)*d+(2*a-5*b+4*c-e)*d*d+(-a+3*b-3*c+e)*d*d*d)).coerceIn(-1.0,1.0)
        }
        fun score(bpm: Double): Double {
            val lag=60/bpm/step
            var total=0.0; var weight=0.0
            // A broad beat also resembles frames a little before and after it. Requiring
            // repetition over several cycles separates nearby tempi from that same peak.
            for (multiple in 1..3) {
                val value=at(lag*multiple) ?: continue
                val w=when (multiple) { 1 -> .5; 2 -> .3; else -> .2 }
                total+=value*w; weight+=w
            }
            return if (weight>0) total/weight else -1.0
        }
        var bpm=120.0; var quality=-1.0; var bestScore=-1.0
        for (candidate in 120..400) {
            val rate=candidate/2.0
            val c=score(rate)
            val assisted=c
            if (assisted>bestScore) { bestScore=assisted; quality=c; bpm=rate }
        }
        // When alternate beats have different timbres, every second beat correlates best.
        // Keep the intervening pulse if it is almost as repeatable, rather than halving tempo.
        if (bpm*2<=200 && score(bpm*2)>=max(.45,quality*.85)) { bpm*=2; quality=score(bpm) }
        if (quality<.43 || span*bpm/60<5-1e-6) return null
        var competitor=-1.0
        for (candidate in 120..400) {
            val ratio=ln((candidate/2.0)/bpm)
            val value=score(candidate/2.0)
            if (abs(ratio)>.10 && abs(abs(ratio)-ln(2.0))>.10 && abs(abs(ratio)-ln(3.0))>.10 &&
                value>=score(candidate/2.0-.5) && value>=score(candidate/2.0+.5)) competitor=max(competitor,value)
        }
        val separation=((quality-competitor)/.30).coerceIn(0.0,1.0)
        val period=60/bpm
        val now=samples.last().time
        val sums=DoubleArray(64); val weights=DoubleArray(64)
        for (sample in samples) {
            val position=(sample.time-now)/period
            val phase=(position-floor(position))*64
            val bin=phase.toInt().coerceIn(0,63)
            val fraction=phase-bin
            val weight=exp((sample.time-now)/3.5)
            val value=sample.value*sample.value
            sums[bin]+=value*weight*(1-fraction); weights[bin]+=weight*(1-fraction)
            sums[(bin+1)%64]+=value*weight*fraction; weights[(bin+1)%64]+=weight*fraction
        }
        val folded=DoubleArray(64) { bin ->
            var sum=0.0; var weight=0.0
            for (offset in -5..5) {
                val kernel=exp(-.5*(offset/2.0).pow(2))
                val index=Math.floorMod(bin+offset,64)
                sum+=sums[index]*kernel; weight+=weights[index]*kernel
            }
            sum/max(1e-9,weight)
        }
        val peak=folded.indices.maxBy { folded[it] }
        val contrast=((folded[peak]-folded.average())/max(.001,folded[peak])).coerceIn(0.0,1.0)
        val count=max(3,(span*bpm/60).toInt())
        val strength=samples.map { it.value }.sortedDescending().take(count).average()
        val strengthSupport=(strength/.30).coerceIn(0.0,1.0)
        val confidence=(.5*quality+.5*separation)*(.85+.15*contrast)*strengthSupport
        return Estimate(bpm,now+peak/64.0*period,confidence)
    }
}
