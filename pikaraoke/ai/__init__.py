"""Karaoke tracks made by machine: vocal removal (Demucs) and word-timed lyrics (Whisper).

Everything heavy runs in a separate worker process (`pikaraoke.ai.worker`); the
server only queues songs, watches progress and serves the results.
"""
