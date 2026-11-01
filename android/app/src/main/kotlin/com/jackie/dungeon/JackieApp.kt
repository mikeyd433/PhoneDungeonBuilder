package com.jackie.dungeon

import android.app.Application

class JackieApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppGraph.init(this)
        CloudSync.init(this)
        Studio.init(this)
    }
}
