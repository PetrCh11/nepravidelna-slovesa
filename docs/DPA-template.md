# Smlouva o zpracování osobních údajů (DPA)

**uzavřená podle čl. 28 Nařízení Evropského parlamentu a Rady (EU) 2016/679 (GDPR)**

---

## Smluvní strany

### Správce osobních údajů

**Název školy:** _______________________________________

**Sídlo:** _______________________________________

**IČO:** _______________________________________

**Zastoupený:** _______________________________________ (ředitel/ředitelka školy)

dále jen „**Správce**"

### Zpracovatel osobních údajů

**Jméno:** Petr Chamula

**Sídlo:** _______________________________________

**IČO:** _______________________________________

**Kontakt:** hello@ucseslovesa.cz

provozovatel webové aplikace **ucseslovesa.cz** (dále jen „**Aplikace**")

dále jen „**Zpracovatel**"

---

## 1. Předmět smlouvy

1.1. Tato smlouva upravuje práva a povinnosti smluvních stran při zpracování osobních údajů žáků a zaměstnanců Správce, ke kterému dochází v souvislosti s užíváním Aplikace pro výuku anglických nepravidelných sloves.

1.2. Zpracovatel zpracovává osobní údaje výhradně pro Správce a na základě jeho doložených pokynů, v rozsahu nezbytném pro plnění předmětu této smlouvy.

---

## 2. Kategorie subjektů údajů a osobních údajů

### 2.1. Subjekty údajů

- Žáci školy, kteří užívají Aplikaci v rámci výuky
- Pedagogičtí pracovníci Správce, kteří užívají Aplikaci

### 2.2. Kategorie zpracovávaných osobních údajů

Zpracovatel zpracovává následující osobní údaje pouze v případě, že se subjekt údajů dobrovolně přihlásí přes Google účet (přihlášení není povinné pro užívání základních funkcí Aplikace):

| Kategorie | Údaje | Zdroj |
|---|---|---|
| Identifikační | Emailová adresa, jméno a příjmení | Google OAuth |
| Provozní | Pokrok ve cvičení, statistiky úspěšnosti, streak | Aktivita v Aplikaci |
| Technické | IP adresa, typ zařízení (anonymně) | Plausible Analytics |

**Aplikace nezpracovává** žádné citlivé osobní údaje (zdravotní stav, etnický původ, politické názory apod.) ani údaje umožňující identifikaci konkrétní školy bez aktivního zadání ze strany Správce.

---

## 3. Účel a doba zpracování

3.1. **Účel:** Poskytování přístupu k Aplikaci, synchronizace pokroku mezi zařízeními uživatele, statistické vyhodnocení používání Aplikace.

3.2. **Doba zpracování:** Po dobu trvání licenčního vztahu mezi Správcem a Zpracovatelem, prodlouženou o nezbytnou dobu pro vyřešení případných nároků. Po ukončení smluvního vztahu Zpracovatel osobní údaje vymaže nebo anonymizuje do **30 dnů**, pokud Správce nepožádá o jejich předání.

---

## 4. Povinnosti Zpracovatele

Zpracovatel se zavazuje:

a) zpracovávat osobní údaje výhradně na základě doložených pokynů Správce;

b) zajistit, aby osoby oprávněné zpracovávat osobní údaje byly zavázány mlčenlivostí;

c) přijmout vhodná **technická a organizační opatření** zajišťující úroveň zabezpečení odpovídající riziku, zejména:
   - šifrování přenosu dat (HTTPS/TLS),
   - šifrování v klidu (Firebase / Google Cloud),
   - kontrola přístupů a auditní záznamy,
   - pravidelné zálohování,
   - schopnost obnovení dostupnosti údajů v případě fyzického či technického incidentu;

d) **nepředávat osobní údaje** dalším zpracovatelům bez předchozího písemného souhlasu Správce, s výjimkou subzpracovatelů uvedených v Příloze č. 1;

e) být **nápomocen Správci** při plnění jeho povinností (žádosti subjektů údajů, ohlašování porušení zabezpečení, posouzení vlivu na ochranu osobních údajů — DPIA);

f) **ohlásit Správci porušení zabezpečení** osobních údajů bez zbytečného odkladu, nejpozději do **48 hodin** od zjištění;

g) po skončení poskytování služeb dle volby Správce všechny osobní údaje **vymazat nebo vrátit** Správci a vymazat existující kopie, pokud právní předpis EU nebo členského státu nepožaduje uložení daných osobních údajů;

h) **poskytovat Správci veškeré informace** potřebné k doložení splnění povinností a umožnit audity (max. 1× ročně, s předchozím oznámením 30 dní předem).

---

## 5. Povinnosti Správce

Správce se zavazuje:

a) zpracovávat osobní údaje v souladu s GDPR a být odpovědný za zákonnost zpracování;

b) **informovat žáky a jejich zákonné zástupce** o zpracování osobních údajů Zpracovatelem prostřednictvím Aplikace, v souladu s čl. 13 GDPR;

c) získat potřebné souhlasy se zpracováním, pokud jsou vyžadovány (zejména u žáků mladších 15 let);

d) udělovat Zpracovateli pokyny pouze prostřednictvím elektronické pošty nebo písemně.

---

## 6. Subzpracovatelé

6.1. Správce uděluje Zpracovateli obecný souhlas k zapojení dalších zpracovatelů uvedených v **Příloze č. 1**.

6.2. Zpracovatel informuje Správce o jakýchkoli zamýšlených změnách týkajících se přidání nebo nahrazení dalších zpracovatelů a poskytne Správci možnost vznést proti těmto změnám námitky.

---

## 7. Zabezpečení a porušení zabezpečení

7.1. Zpracovatel implementoval následující bezpečnostní opatření:
- veškerá komunikace probíhá výhradně přes HTTPS s TLS 1.2+,
- údaje jsou ukládány v Google Firebase (Google Cloud Platform — certifikace ISO 27001, SOC 2, GDPR),
- přístup k administraci je chráněn dvoufaktorovým ověřením,
- pravidelné zálohy a možnost obnovy,
- ochrana proti útokům na úrovni infrastruktury (Cloud Armor, rate limiting).

7.2. V případě porušení zabezpečení osobních údajů Zpracovatel:
- bez zbytečného odkladu, nejpozději do 48 hodin, oznámí porušení Správci;
- poskytne Správci popis incidentu, kategorie a přibližný počet dotčených subjektů údajů, pravděpodobné důsledky a přijatá nápravná opatření.

---

## 8. Závěrečná ustanovení

8.1. Tato smlouva nabývá platnosti a účinnosti dnem podpisu obou smluvních stran.

8.2. Smlouva se uzavírá na dobu trvání licenčního vztahu mezi Správcem a Zpracovatelem.

8.3. Tato smlouva se řídí právním řádem České republiky a Nařízením GDPR.

8.4. Smlouva je vyhotovena ve dvou stejnopisech, z nichž každá strana obdrží jeden.

---

**V _______________________ dne _______________**

**Za Správce:**                                                **Za Zpracovatele:**


_______________________________                                 _______________________________
(podpis a razítko)                                              Petr Chamula

---

## Příloha č. 1 — Seznam subzpracovatelů

| Subzpracovatel | Účel | Umístění dat | Záruky GDPR |
|---|---|---|---|
| **Google LLC (Firebase / Firestore)** | Ukládání pokroku uživatelů, autentizace | EU (region europe-west) | Standardní smluvní doložky EU, certifikace ISO 27001, SOC 2 |
| **Google LLC (OAuth)** | Přihlášení uživatelů | EU/USA | Standardní smluvní doložky EU |
| **Plausible Analytics (Plausible Insights OÜ)** | Anonymní statistiky návštěvnosti | EU (Německo) | GDPR-compliant by design, bez cookies, bez osobních údajů |
| **Stripe Payments Europe Ltd.** | Zpracování plateb (pouze pro individuální předplatné, ne pro školní licence) | EU (Irsko) | PCI DSS Level 1, GDPR |
| **Railway Corp.** | Hosting backend API | EU | Standardní smluvní doložky |

---

*Tento dokument je standardní zpracovatelská smlouva pro školní licenci aplikace ucseslovesa.cz. V případě potřeby úprav specifických pro konkrétní školu kontaktujte hello@ucseslovesa.cz.*
