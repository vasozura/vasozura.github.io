# Acoustic guitar sample attribution

The audio samples in this directory are from
[`nbrosowsky/tonejs-instruments`](https://github.com/nbrosowsky/tonejs-instruments),
which identifies its samples as licensed under
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

Only a sparse set of pitch roots is bundled. The playback engine transposes the
nearest decoded sample to the requested MIDI pitch, lazy-loads this bank only
after Guitar is selected, and retains decoded buffers in memory.
