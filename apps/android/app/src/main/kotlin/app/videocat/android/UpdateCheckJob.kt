package app.videocat.android

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import java.io.IOException
import java.util.concurrent.Executors

/**
 * Looks for a new version every few hours, with the app closed too, and leaves a notification
 * when there is one. With the app open, MainActivity offers it instead.
 */
class UpdateCheckJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        executor.execute {
            try {
                val release = AppUpdates.check(applicationContext)
                if (release != null && !VideoCatApp.inForeground) AppUpdates.notify(applicationContext, release)
                jobFinished(params, false)
            } catch (_: IOException) {
                // No network or GitHub is busy: try again later.
                jobFinished(params, true)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    companion object {
        private const val JOB_ID = 2601
        private const val EVERY_MS = 6L * 60 * 60 * 1000
        private val executor = Executors.newSingleThreadExecutor()

        fun schedule(context: Context) {
            if (!AppUpdates.enabled) return
            val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
            if (scheduler.getPendingJob(JOB_ID) != null) return
            val job = JobInfo.Builder(JOB_ID, ComponentName(context, UpdateCheckJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(EVERY_MS)
                .setPersisted(true)
                .build()
            scheduler.schedule(job)
        }
    }
}
