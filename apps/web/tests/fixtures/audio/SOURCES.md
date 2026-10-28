# Audio fixtures: sources and licences

These recordings are used by the speech-to-text integration test (`tests/integration/stt.spec.ts`). They come from an official sherpa-onnx model repository and are unmodified. **No recording of anyone on the team is ever added here.**

| File    | Bytes   | SHA-256                                                            | Reference transcript                                                                                                                                                                                                                                      |
| ------- | ------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.wav` | 212,044 | `6bc58a4efdf20daac252b6b1502632601a71efe0308f6757dc1eda34891a7e4f` | AFTER EARLY NIGHTFALL THE YELLOW LAMPS WOULD LIGHT UP HERE AND THERE THE SQUALID QUARTER OF THE BROTHELS                                                                                                                                                  |
| `1.wav` | 534,924 | `5143a6ba93c4b274e2c4ac22deb75c2c48936c853f0519add1de828b6c79cc5a` | GOD AS A DIRECT CONSEQUENCE OF THE SIN WHICH MAN THUS PUNISHED HAD GIVEN HER A LOVELY CHILD WHOSE PLACE WAS ON THAT SAME DISHONOURED BOSOM TO CONNECT HER PARENT FOR EVER WITH THE RACE AND DESCENT OF MORTALS AND TO BE FINALLY A BLESSED SOUL IN HEAVEN |

- **Repository:** https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21, folder `test_wavs/`. This is the same repository as Kite's speech-to-text model.
- **Commit:** `9a65b6ea94c311ca770c2bf895b30f456a22d703`. It is the same commit as the model files and `TEST_RECORDINGS` in `src/core/stt/models.ts`.
- **Reference transcripts:** `test_wavs/trans.txt` in that commit. The lines for these two files are copied unchanged into `trans.txt` here. The line for `8k.wav` is left out because that recording is not used.
- **Licence:** the repository is published under **Apache-2.0** (its model card and the Hugging Face licence tag, checked 2026-10-28).
- **Origin of the speech:** the recordings are utterances from the LibriSpeech corpus (public-domain audiobooks from LibriVox; the corpus is distributed under CC BY 4.0 by OpenSLR, resource 12).
- **Format:** 16 kHz, mono, 16-bit PCM WAV.

The test checks each file against the SHA-256 above, through `TEST_RECORDINGS` in `models.ts`, before using it.
