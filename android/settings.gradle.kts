pluginManagement {
    repositories {
        // Google's mirror of Maven Central first: Central rate-limits (HTTP 429)
        // build machines that fetch a lot at once.
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // Google's mirror of Maven Central first: Central rate-limits (HTTP 429)
        // build machines that fetch a lot at once.
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        google()
        mavenCentral()
    }
}
rootProject.name = "JackieDungeon"
include(":engine", ":app")
