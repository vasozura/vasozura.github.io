# KinoStudio Georgian narrator samples

PC3 checkpoint, 2026-11-26.

| Voice | Result | Render time and VRAM | Model licence |
| --- | --- | --- | --- |
| Piper ka_GE-natia-medium | MP3 verified by ffprobe and a full FFmpeg decode. 13.91 s, 22,050 Hz, 128 kb/s. | 4.57 s wall time for the Piper CLI, excluding MP3 encoding. ONNX Runtime CPU provider, no GPU used for synthesis. | Voice repository advertises MIT. The Natia model card points to a dataset LICENSE file, which is absent from the voice directory and returned HTTP 404. Dataset licence remains unverified. |
| Georgian F5-TTS | The published file lists for both allowed checkpoints contain no bundled reference audio. NMikka's example loads a Common Voice speaker from a separate dataset. The task requires a bundled reference and excludes a real person's voice. | No render or VRAM measurement. | **CC BY-NC 4.0, non-commercial**, for both checkpoints. |
| Meta MMS-TTS Georgian | The exact facebook/mms-tts-kat model API returned HTTP 401. Meta's public MMS-TTS model card does not list kat. | No render or VRAM measurement. | The MMS-TTS collection is **CC BY-NC 4.0, non-commercial**. The exact checkpoint could not be verified. |

Piper audio is available on PC3 at D:/ZuraWork/kino_voices/sample_1_piper.mp3. The remote is public, so the audio stayed on PC3 under the scheduled run's publication restriction. The listening comparison still needs a qualifying bundled F5 reference, a verified Georgian MMS checkpoint or an approved substitute, and a private delivery destination if the owner wants to listen off PC3.

Sources

- [Piper Natia model card](https://huggingface.co/rhasspy/piper-voices/blob/main/ka/ka_GE/natia/medium/MODEL_CARD) and [voice directory](https://huggingface.co/rhasspy/piper-voices/tree/main/ka/ka_GE/natia/medium)
- [NMikka model card](https://huggingface.co/NMikka/F5-TTS-Georgian) and [file list](https://huggingface.co/NMikka/F5-TTS-Georgian/tree/main)
- [tabluka90 model card](https://huggingface.co/tabluka90/georgian-f5-tts) and [file list](https://huggingface.co/tabluka90/georgian-f5-tts/tree/main)
- [Meta MMS-TTS model card](https://huggingface.co/facebook/mms-tts)
