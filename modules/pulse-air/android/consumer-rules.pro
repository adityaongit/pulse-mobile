# libxp.so resolves these classes and callbacks by their JNI names, including callbacks with no Kotlin caller.
-keep class com.fitbit.goldengate.bindings.** { *; }
