if [ ! $EMSCRIPTEN ]; then
    echo "EMSCRIPTEN variable not defined; please navigate to your Emscripten repository and execute, \"source ./emsdk_env.sh\", then try again."
    echo "Run failed."
else
    echo "Serving with emrun.  Press CTRL+C to terminate."
    emrun --no_browser --port=8080 .
fi