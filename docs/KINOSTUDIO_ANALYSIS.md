# KinoStudio — არსებული პროგრამების შეფასება

2026-11-22 · მხოლოდ ანალიზი; განხორციელების გეგმა ჯერ დასამტკიცებელია.

1. რეკომენდაცია: ერთი KinoStudio ვებინტერფეისი Studio Portal-ში.
2. პროექტისა და აუდიოს საფუძვლად გამოვიყენოთ CineAudio-ს არსებული მოდულები.
3. წიგნის ქართული ტექსტი და მისი წყაროს მითითებები უცვლელად შევინახოთ.
4. სცენებისა და კადრების დაგეგმვისთვის გამოვიყენოთ Maestro Director.
5. პერსონაჟის გარეგნობა Maestro Character Studio-დან, ხმა CineAudio-დან იმართოს.
6. ვიდეო შექმნას უკვე არსებულმა Wan/LTX ძრავებმა; თითო კადრი მაქსიმუმ 10 წამი.
7. Aurora-დან ავიღოთ პროექტის/კადრის კონტრაქტები და ვალიდაციის გამოცდილება.
8. Unified Director-დან ავიღოთ პერსონაჟის მონაწილეობისა და სტილის ველები.
9. პირველი შედეგი: ერთი ქართული თავის 1–2 წუთიანი, ხელით განხილული ეკრანიზაცია.
10. ამ შემოწმებით ფილმი არ შექმნილა; აპები და მათი მონაცემები არ შეცვლილა.

## რა მუშაობს რეალურად

ზომები დათვლილია მხოლოდ სამუშაო კოდზე: `src/` ან `app/`, Python/HTML/CSS/JS; ცარიელი ხაზებიც ითვლება. ასლები, გამოშვებები, გარემოები და მოდელები გამორიცხულია. ტესტები შერჩევითია; მთელი პროდუქტის მზადყოფნას არ ადასტურებს.

| პროგრამა | მოქმედი ნაწილი და მტკიცებულება | შეზღუდვა / ხარისხი / დამოკიდებულებები |
|---|---|---|
| Aurora Studio | 98 ფაილი, 21,904 ხაზი; ტესტები: 131 ფაილი, 32,893 ხაზი. პროექტის შენახვა/აღდგენა, სცენა/კადრი, პერსონაჟი, ტაიმლაინი, prompt-ის ექსპორტი. 110 შერჩეული ტესტი გავიდა. | მკაფიო contracts/modules/services დაყოფა, თუმცა `ui/actions.py` 3,411 და `desktop_shell.py` 2,274 ხაზია. Python ≥3.11 + tkinter, სავალდებულო გარე პაკეტების გარეშე. AFL მხოლოდ სტრუქტურას ამოწმებს; სემანტიკურ კინოს არ გეგმავს. სურათის/ვიდეოს mock რეალურ მედიას არ ქმნის; plugin runtime stub-ია. ტექსტის რეალური HTTP ადაპტერი არსებობს, ამ სესიაში არ გამოძახებულა. |
| CineAudio (`movie_maker`) | 91 ფაილი, 22,121 ხაზი; ტესტები: 26 ფაილი, 5,959 ხაზი. ქართული ტექსტი/PDF → ანალიზი → ხმები/SFX/მუსიკა → ducking → მრავალკლიპიანი მონტაჟი/FFmpeg ექსპორტი. 34 შერჩეული ტესტი გავიდა, მათ შორის ნამდვილი სინთეზური მედიის რენდერი. | ყველაზე გამოსადეგი საფუძველი: Pydantic კონტრაქტები, SQLite, provenance, ქეში, აღდგენა და უცვლელი წყარო. GUI 3,921, CLI 1,864 ხაზია — პირდაპირ ვებში გადატანა დიდია; სერვისები გამოვიყენოთ. `pyproject.toml` უკვე **0.10.0**-ია. Python ≥3.11, Pydantic 2, SQLAlchemy 2, httpx, Typer, structlog, tenacity, pypdf, NumPy, Piper; GUI-სთვის PySide6; სისტემური FFmpeg/ffprobe. |
| AI Film Director Unified | 57 ფაილი, 2,040 ხაზი; ავტომატური ტესტების საქაღალდე არ აქვს. იზოლირებულ ასლში საკუთარი გარემოთი მთავარმა გვერდმა 200 დააბრუნა; შეიქმნა 250 სცენა, prompt ტექსტი და rewrite-ის ვერსია; OpenAPI-ში 32 გზა. | FastAPI 0.115.12, SQLAlchemy 2.0.40, Jinja2 3.1.6, Pydantic 2.11.4, uvicorn, multipart, pandas/openpyxl. `generate_scene` ტექსტს აწყობს, ვიდეოს არ ქმნის; rewrite მხოლოდ ტეგს ამატებს, memory ინახავს შეჯამებას, export აბრუნებს პარამეტრებს. `Scene`-ს project_id არ აქვს; ბევრი ოპერაცია მთელ ცხრილზე მუშაობს. მრავალპროექტიანი საფუძვლისთვის სუსტია. |

**მნიშვნელოვანი დეტალები:** Aurora-ს README ჩამორჩენილია: კოდში უკვე არის autosave, local store და რეალური ტექსტის ადაპტერის გზა; მხოლოდ README-ს მიხედვით შეფასება მცდარი იქნებოდა. `aurora-spec`-ის core contracts და AFL დოკუმენტები Draft-ია და საბოლოო შესანახ ფორმატს არ განსაზღვრავს. CineAudio-ს mock ხმები სატესტო ტონებია. ბუნებრივი ქართული Piper/OmniVoice და ElevenLabs გზები კოდში არსებობს, მაგრამ ამ სესიაში მათი ხარისხი, მოდელები და სრული სამუშაო მზადყოფნა არ შემოწმებულა. გამოსახულებისგან შედგენილი PDF-ის OCR ცალკე სამუშაოა.

Unified-ის `generator_service.py` წარმატებულ Excel წაკითხვაზე აწყობილ prompt-ს ცვლის `str(row.to_dict())`-ით და რიგს `scene_id - 1`-ით ირჩევს. Excel მისამართი `D:\ai_film_generator_final_all_build_v2.xlsx`-ია; smoke-ში ფაილი ვერ მოიძებნა. `excel_sync_service.import_timeline_to_db` სცენების ცხრილს შლის; მისი გამოყენება არ არის რეკომენდებული და არ გაშვებულა. `ensure_250_scenes` ნაწილობრივ შევსებულ ბაზაში კიდევ 250 რიგს დაამატებს. არსებულ ბაზაზე მთავარი გვერდიც წერს მონაცემებს, ამიტომ შემოწმდა მხოლოდ `tmp/` ასლი.

## რა შევინარჩუნოთ, გამოვიყენოთ ან გამოვტოვოთ

„გამოვტოვოთ“ ნიშნავს ახალ KinoStudio-ში არ ჩავრთოთ; ძველი აპების წაშლა არ იგულისხმება.

| წყარო / მოდული | გადაწყვეტილება | გამოყენება |
|---|---|---|
| Aurora project/scene/shot/character contracts | reuse | სტაბილური ID-ები, კავშირები, სტატუსები; გარდაქმნა CineAudio-ს მოდელებში |
| Aurora local store, backups, validation tests | reuse | ატომური შენახვისა და აღდგენის წესები; მეორე დამოუკიდებელი საცავის გარეშე |
| Aurora AFL camera/emotion/composition/motion | reuse ნაწილობრივ | არასავალდებულო კადრის ველები; ახალი ენის/კომპილატორის შექმნა MVP-ს არ სჭირდება |
| Aurora tkinter, plugin/mock media სისტემები | drop MVP-დან | ვებფორმები სერვისებს მიმართავს; არსებულ გენერატორებს ვიყენებთ |
| CineAudio importers + analysis schemas/services | keep/reuse | ტექსტი, ქართული PDF, აბზაცის/page provenance, დამტკიცებული დიალოგი |
| CineAudio workspace/database/jobs/cache | keep/reuse | ერთი პროექტის საფუძველი, მიგრაციები, ქეშის გაუქმება, ხელახალი გაშვება |
| CineAudio TTS/sound/music | keep/reuse | ხმა, გამოთქმა, ლოკალური აუდიობიბლიოთეკა, gain/fades/ducking |
| CineAudio timeline/edit_list/rendering/export | keep/reuse | ძირითადი მონტაჟი და საბოლოო მიქსი; Qt GUI ჩანაცვლდება ვებგვერდით |
| Unified character presence / StyleDNA / relationships | reuse იდეა და ველები | პერსონაჟის როლი, გარდერობი, სტილი; project-scoped ID-ებზე გადატანა |
| Unified scaffold/Excel override/rewrite stub/global DB | drop MVP-დან | რეალური საჭიროების მიხედვით სცენები; დამანგრეველი იმპორტის გარეშე |
| Maestro Director + keyframes + generation + Editor | keep, adapter | არსებული დაგეგმვა/გენერაცია; Editor-ის პროექტთან გაცვლის ფორმატი ჯერ შესამოწმებელია |
| Maestro Character Studio | keep, adapter | არსებული reference სურათები/ხმები და stable-id → Maestro ID რუკა; იგივე პერსონაჟი ხელახლა არ შეიქმნას |
| MusicToVideo engine_selection + assembly | reuse | Wan/LTX არჩევანი, ≤10 წმ დაყოფა, საწყისი/ბოლო კადრი, GPU კონტროლი |
| Portal + studio_common | keep/reuse | ერთი შესასვლელი, საერთო ვიზუალი, status/progress/cancel/thumbnail/probe |

Character Studio იყენებს Maestro-ს HTTP API-ს, backup/dry-run/import მექანიზმს; პორტრეტის A1111 და Windows SAPI ხმის გზებიც აქვს. მისი არსებული ვებგვერდი მეორე მთავარ რედაქტორად არ ვაქციოთ: KinoStudio-მ პერსონაჟის ID და asset-ები გამოიყენოს. ამ სესიაში არც import/apply და არც გენერაცია გაშვებულა.

Maestro-ს `docs/Director-controls.md` და `app/services/director_pipeline.py` ადასტურებს დაგეგმვის, continuity, keyframe-ებისა და Editor-ის გზების არსებობას. `app/docs/CLI.md` აღწერს `wgp.py --process ... --output-dir ...`-ს. MusicToVideo-ს Wan/LTX მუშაობის უკვე დასრულებული მტკიცებულებაა [engine-switch ანგარიში](MUSICTOVIDEO_ENGINE_SWITCH_2026-11-22.md). ახალი Maestro API ინტეგრაცია და Editor-ის round-trip ამ ანალიზში არ შესრულებულა.

## ერთი სამუშაო პროცესი და ერთი UI

Portal-ის მენიუში დაემატოს **KinoStudio**, საკუთარი ლოკალური ვებსერვისით. ერთი გვერდის ნაბიჯები: **წიგნი → სცენები → კადრები → პერსონაჟები → გენერაცია → ხმა → მონტაჟი → ექსპორტი**. მომხმარებელი ხედავს წყაროს, preview-ს, დამტკიცებას და პროგრესს; JSON-ს ან შიდა API-ს ხელით არ ავსებს.

1. CineAudio შემოიტანს თავს და უცვლელად შეინახავს წყაროს; მომხმარებელი აირჩევს 1–2 წუთისთვის საჭირო მონაკვეთს.
2. ტექსტის ანალიზი გამოყოფს სცენას, მოქმედებას, მოსაუბრეს და ზუსტ ციტატას. გაურკვეველი მოსაუბრე და ადაპტირებული ტექსტი ცალკე ჩანს. სცენებს მომხმარებელი ამტკიცებს.
3. არსებული Maestro Director შექმნის კადრების გეგმას. თითო კადრი ≤10 წმ, ერთი გასაგები მოქმედება, მშვიდი კამერა და კონკრეტული საწყისი/ბოლო მდგომარეობა. ხანგრძლივობა ჯერ მეტყველების შეფასებას, შემდეგ რეალურ WAV-ს ერგება; წიგნის ფილმს სიმღერის beat-grid არ უნდა ვაიძულოთ.
4. პერსონაჟის ერთ ჩანაწერს ექნება გარეგნობის reference, კოსტიუმი და ხმა. Character Studio/Maestro ID რუკა შეინახება პროექტში; CineAudio voice profile იმავე ID-ს დაუკავშირდება.
5. დამტკიცდება keyframe-ები. არსებული Wan/LTX adapter შექმნის ცალკეულ კადრებს. ერთი მდგრადი GPU რიგი გააკონტროლებს Maestro/Wan/TTS სამუშაოებს; ერთდროული მძიმე GPU პროცესები გამოირიცხება. არსებული MusicToVideo guard გამოვიყენოთ, მაგრამ მისი process-local lock მთელი კომპიუტერის საერთო რიგს ვერ ცვლის.
6. CineAudio შექმნის დამტკიცებულ ხმებს, დაამატებს არჩეულ SFX-ს/მუსიკას და ducking-ს. ვიდეოგენერატორის ხმა ცალკე დაიდუმოს; არჩეული წყაროს მუსიკა შეინახება და საბოლოო მიქსში შევა.
7. ერთ timeline-ში მომხმარებელი შეცვლის რიგს, trim-ს, პაუზებს, ხმის დონეს და გადასვლებს. CineAudio edit list იყოს ძირითადი; Maestro Editor-თან გაცვლა adapter-ით, წარმატებული round-trip შემოწმების შემდეგ. მეორე დამოუკიდებელი timeline ბაზა არ შეიქმნას.
8. FFmpeg შექმნის review ექსპორტს, აუდიო stems-სა და პროექტის ანგარიშს. ჩავარდნილი კადრის ხელახალი ცდა მხოლოდ მის წარმოებულ მასალას გააუქმებს; დამტკიცებული მეზობელი კადრები შენარჩუნდება.

ვებსერვისი მხოლოდ მართავს; CineAudio და გენერატორები საკუთარ პროცესებსა და გარემოებში მუშაობენ. ასე PySide/Piper/PyTorch/diffusers ერთ Python გარემოში არ აირევა. `studio_common.jobs` ახლა მეხსიერებაშია და daemon thread-ს იყენებს: UI პროგრესისთვის გამოსადეგია, გადატვირთვის შემდეგ აღდგენის წყაროდ — CineAudio-ს მდგრადი job ჩანაწერები გამოვიყენოთ.

## მონაცემების ერთი ადგილი

შემოთავაზება: `D:\Prog\KinoStudio\Projects\<project-id>\`. ეს საქაღალდე ჯერ არ შექმნილა. CineAudio-ს workspace ფორმატს დაემატოს schema migration, shot/character ველები და adapter-ების რუკები.

```text
project.json                 # schema version, project ID, ენა, fps, ზომა
project.sqlite               # შემოთავაზებული DB სახელი: სცენები/კადრები/ხმები/jobs
source/book|video|metadata/   # უცვლელი შემოტანილი წყარო + checksum
characters/<id>/             # look/voice references, provenance, Maestro ID
plans/                       # წყაროს აბზაცები → scene IDs → shot IDs, revisions
generated/keyframes|video/   # ვერსიები, seed/model/settings, hashes
generated/dialogue|narration|sfx|music/
timeline/                    # ძირითადი edit list-ის versioned export
adapters/maestro/             # plan/job/settings და გარე output ID/path რუკა
exports/                     # review MP4, WAV stems, interchange
cache/ proxies/ logs/ reports/ temp/
```

ეს არის **სამიზნე შეთანხმება**, არა არსებული CineAudio სქემის ზუსტი აღწერა. SQLite იქნება ოპერაციული სიმართლის წყარო; `plans/` და `timeline/` — ვერსირებული snapshot/export. JSON და DB პარალელურად დამოუკიდებლად არ რედაქტირდება. დრო: მთელი მილიწამები; ვიდეოსთვის rational fps/frame index, აუდიოსთვის samples. ყველა გენერირებული asset შეიცავს source/plan hash-ს, engine/model/seed/settings-ს და approval revision-ს. Maestro-ს გარე output პროექტში დამოწმებული ასლით შემოდის; ორიგინალი რჩება. გასაღებები პროექტსა და Git-ში არ ინახება.

## პირველი შედეგი და სამუშაოს შეფასება

MVP: ერთი მოკლე ქართული თავის შერჩეული ეპიზოდი; 2 პერსონაჟი, 1–2 ადგილი, 12–20 კადრი, ჯამში 60–120 წმ. პირველი ვერსია გამოიყენებს მთხრობელს/კადრსგარეთა დიალოგს; ბუნებრივი ქართული ხმის არჩევა ცალკე მოსასმენი შემოწმებაა. ზუსტი ტუჩის სინქრონიზაცია შემდეგი ეტაპია. საბაზისო ვიდეო: არსებული LTX recipe 1280×704, 24 fps; Wan ალტერნატივად. პროექტი აჩვენებს native ზომას; დიდი ექსპორტი დამატებით დეტალს ავტომატურად არ ნიშნავს.

| ნაბიჯი | შედეგი / მისაღები შემოწმება | შეფასება |
|---|---|---|
| 1. კონტრაქტები და adapter spike | Georgian import, CineAudio workspace migration, ერთი Maestro plan/keyframe/job mapping, restart-safe სტატუსი | 2–3 დღე |
| 2. Portal UI და ტექსტის განხილვა | წიგნის მონაკვეთი → დამტკიცებული სცენები/კადრები; ქართული სახელები და შეცდომების გასაგები ტექსტი | 3–4 დღე |
| 3. პერსონაჟები და გენერაციის რიგი | არსებული reference/voice IDs, Wan/LTX, cancel/retry, GPU სერიალიზაცია; ერთი საცდელი კადრი | 3–5 დღე |
| 4. აუდიო | ბუნებრივი ხმის მოსმენა, cue timing, SFX/music/ducking, ხანგრძლივობის კონფლიქტის ჩვენება | 2–4 დღე |
| 5. მონტაჟი და აღდგენა | რიგი/trim/gap/აუდიო, Maestro interchange შემოწმება, კადრის შეცვლის selective invalidation | 3–4 დღე |
| 6. თავი თავიდან ბოლომდე | 1–2 წუთის MP4, გადატვირთვის შემდეგ გაგრძელება, source hash უცვლელია, მედიის decode/probe | 2–3 დღე |

ჯამი **15–23 სამუშაო დღე** ერთ დეველოპერზე, შემოწმებული კომპონენტების გამოყენებით; ეს დაგეგმვის შეფასებაა. GPU რენდერის/რიგის დრო, მოდელების ჩამოტვირთვა და შემოქმედებითი ხელახალი ცდები ცალკეა. პირველი ნაბიჯის API/format spike შეამცირებს მთავარ გაურკვევლობას; შემდეგ Claude-მ უნდა დაალაგოს განხორციელების ამოცანები.

## ღია კითხვები მფლობელისთვის

- რომელი წიგნი/თავი და კონკრეტული 1–2 წუთიანი ეპიზოდი ავიღოთ პირველ მაგალითად?
- ტექსტი სიტყვასიტყვით უნდა დარჩეს თუ მოკლე ეკრანიზაციის ადაპტაცია შეიძლება?
- როგორი ვიზუალური სტილი და რომელი ორი პერსონაჟის reference გამოვიყენოთ?
- პირველ ვერსიაში მთხრობელი/კადრსგარეთა ხმა მისაღებია? რომელი არსებული ქართული ხმა მოსწონს?
- ნებადართულია ფასიანი LLM/TTS გამოძახებები? რა არის ერთი ცდის ბიუჯეტი და დროის მისაღები ზღვარი?

## შემოწმების მოკლე ჩანაწერი

ყველა აპი წაკითხულია ადგილზე; კოდი/კონფიგურაცია/არსებული პროექტები არ შეცვლილა. ტესტებს ჰქონდათ `PYTHONDONTWRITEBYTECODE=1`; CineAudio-სთვის `pytest -p no:cacheprovider --basetemp <site>/tmp/...`; Unified-ის `app/` დაკოპირდა site-ის იგნორირებულ `tmp/`-ში და მხოლოდ იქ შეიქმნა DB. არც GPU სამუშაო, მოდელის ჩამოტვირთვა, ფასიანი API გამოძახება და არც გამოქვეყნება შესრულებულა.

- Aurora: `python -B -m unittest discover -s <aurora>/tests -p <file>`: `test_afl_engine.py` **14**, `test_local_project_store.py` **18**, `test_timeline_duration_ordering.py` **19**, `test_mock_video_provider_adapter.py` **32**, `test_cli_smoke.py` **27** — სულ **110 pass**. Timeline-ის პირველი ცდა `PYTHONPATH`-ის გარეშე ვერ იმპორტირდა; `PYTHONPATH=<aurora>/src`-ით გავიდა.
- CineAudio: `PYTHONPATH=<movie_maker>/src python -B -m pytest ... -q`: `test_phase2_analysis.py` + `test_phase9_pdf_and_edit_list.py` — **15 pass / 7.00 წმ**; `test_integration_offline_pipeline.py` + `test_phase4_sound_design.py` + `test_phase5_music.py` — **19 pass / 9.31 წმ**. ტესტები სინთეზურ მედია/ტექსტს იყენებს; ბუნებრივი ხმა არ შეფასებულა.
- Unified: სისტემური ახალი Starlette-ით `TemplateResponse` დაეცა (`TypeError: unhashable type: 'dict'`). საკუთარ `.venv`-ში FastAPI **0.115.12** / Starlette **0.46.2**-ით უშუალოდ `home(Request, db)` და სერვისები გავიდა: HTTP response **200**, **250** სცენა, prompt/rewrite და **32** OpenAPI გზა. საკუთარ გარემოში TestClient-ს აკლია `httpx`; არაფერი დაყენებულა. ეს ფუნქციური smoke-ია, სრული HTTP/ბრაუზერის ტესტი არაა.

წაკითხული ძირითადი წყაროები: Aurora `src/aurora_studio/{contracts,modules,services,ui}`, `aurora-spec/05-Data/` და `06-AI/`; CineAudio `pyproject.toml`, `src/cineaudio/{app,analysis,importers,tts,sound,music,timeline}` და ზემოთ ჩამოთვლილი ტესტები; Unified `app/{models,services,api}`; Maestro `docs/Director-controls.md`, `app/docs/CLI.md`, `app/services/director_pipeline.py`; Character Studio `character_ui_server.py`, `IMPORTER_USAGE.md`; MusicToVideo `Program/engine_selection.py`; Portal `README.md`, `Program/main.py`; `_shared/studio_common/jobs.py`. პირდაპირი იმპორტი არსებული აპების გაერთიანებულ პროცესში არ არის შემოწმებული და რეკომენდებული გზაც adapter-ებით ინტეგრაციაა.
