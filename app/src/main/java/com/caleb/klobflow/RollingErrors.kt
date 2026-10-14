package com.caleb.klobflow

/** Display-only averages of observed errors. Raw scores and validity stay authoritative. */
class RollingErrors {
    private val samples=ArrayDeque<Pair<Long,Metrics>>()
    private var key=""
    fun reset(){samples.clear();key=""}
    fun update(time:Long,metrics:Metrics,c:Config):Metrics {
        val nextKey=listOf(c.mode,c.staffCount,c.cx,c.cy,c.scale,c.rotation,c.cubeDepth,c.circleSeparation,c.diagonals,c.planeCorners,c.planeAspect,c.calibrationImageAspect,c.calibrationRotation,c.facing,c.mirror,c.zoom,c.led,c.threshold,c.minLength,c.staffColors).toString()
        if(key!=nextKey||samples.lastOrNull()?.let {time<it.first}==true)reset()
        key=nextKey
        if(samples.lastOrNull()?.first==time)samples.removeLast()
        samples.addLast(time to metrics)
        while(samples.isNotEmpty()&&time-samples.first().first>5000)samples.removeFirst()
        fun average(current:Double?,value:(Metrics)->Double?):Double? {
            if(current==null||!current.isFinite())return null
            val values=samples.mapNotNull {value(it.second)?.takeIf(Double::isFinite)}
            return values.takeIf {it.isNotEmpty()}?.average()
        }
        return metrics.copy(deviation=average(metrics.deviation){it.deviation},angle=average(metrics.angle){it.angle},symmetry=average(metrics.symmetry){it.symmetry})
    }
}
