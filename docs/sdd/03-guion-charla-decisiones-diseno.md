# Guion de charla — Construyendo un flujo SDD con IA

Las decisiones de diseño de la herramienta, en orden narrativo, con qué mostrar
y cómo explicarlo.

Formato de cada momento:
**Qué muestras** · **La decisión** · **La alternativa descartada** · **Por qué**
· **Cómo decirlo** · **La pregunta que te van a hacer**

---

## La tesis

Todo el guion cuelga de una sola idea. Dila temprano y vuelve a ella al cerrar:

> **Con IA, el problema dejó de ser escribir código. El problema es garantizar
> que el código escrito sea el correcto. Y para garantizar algo, pedirlo no
> alcanza.**

Cada decisión de la herramienta es una respuesta a esa frase. Cuando alguien
pregunte "¿por qué tanta ceremonia?", la respuesta siempre es la misma:
la diferencia entre pedir y garantizar.

---

# ACTO 1 — Por qué el spec

## 1.1 · El spec es el código fuente; TypeScript es el output

**Qué muestras.** `docs/business-rules.md` y `constitution.md` lado a lado con
el `src/`.

**La decisión.** Escribir la especificación primero, versionada en el repo.

**La alternativa descartada.** Prompt engineering: iterar en el chat hasta que
salga lo que quieres.

**Por qué.** El chat no es un artefacto. No se versiona, no se revisa, no se
difunde, no sobrevive a la sesión. Cuando alguien pregunta dentro de tres meses
"¿por qué el sistema hace esto?", la respuesta está en un historial que se
perdió. El spec sí es un artefacto: tiene diff, tiene revisión, tiene autor.

**Cómo decirlo.**

> "El código dejó de ser lo escaso. Un modelo te escribe el módulo de reservas
> en cinco minutos. Lo escaso ahora es la definición correcta de qué debe
> hacer. Así que movamos el esfuerzo ahí: el spec es la fuente de verdad, y
> TypeScript pasa a ser output."

**La pregunta que te van a hacer.** _"¿Eso no es volver a cascada?"_

> "No, porque el spec no es un documento que se escribe una vez y se congela.
> Vive en el repo, cambia con PRs y se revisa como código. Es más parecido a un
> test que a un documento de requerimientos."

---

## 1.2 · La ambigüedad se atrapa en markdown, no en producción

**Qué muestras.** La regla BR-04 con su sección de _Open questions_ sin
resolver. Luego corres `/sdd-new` y dejas que `clarify` pregunte en vivo.

**La decisión.** Dejar una ambigüedad plantada a propósito y frenar el flujo
hasta que un humano la resuelva.

**La alternativa descartada.** Que el agente asuma. Es lo que hace por defecto,
y lo hace con mucha seguridad.

**Por qué.** El costo de corregir un defecto crece por órdenes de magnitud
según dónde se detecta. Una ambigüedad resuelta en markdown cuesta dos minutos.
La misma ambigüedad descubierta en producción cuesta un incidente. Lo que hace
peligrosa a la IA no es que se equivoque: es que rellena los huecos sin avisar
que había un hueco.

**Cómo decirlo.**

> "Fíjense en lo que acaba de pasar. Yo dejé sin definir qué pasa si cancelas
> con menos de 24 horas. Un agente normal habría inventado una penalización y
> seguido de largo, y yo me habría enterado en producción. Este preguntó. Esa
> pregunta vale más que las mil líneas que va a escribir después."

**Momento de demo.** Este es el primer aplauso. No lo apures.

**La pregunta.** _"¿Y si pregunta demasiado?"_

> "Pasa, y se calibra en la constitution. Pero prefiero ese problema al
> opuesto: un agente que nunca pregunta te está mintiendo sobre cuánto entiende."

---

## 1.3 · La constitution: una regla, un lugar

**Qué muestras.** `constitution.md`, y después un agente (`implementer.md`) que
cabe en una pantalla.

**La decisión.** Los principios no negociables en un solo archivo que todo
consulta.

**La alternativa descartada.** Repetir las reglas en cada prompt y en cada
agente.

**Por qué.** Si una regla vive en tres archivos, tienes tres versiones que van a
divergir. La duplicación no solo gasta tokens: produce contradicciones, y
cuando el agente encuentra instrucciones contradictorias, elige una. No sabes
cuál.

**Cómo decirlo.**

> "Miren el tamaño de este agente. Cabe en una pantalla. La gente asume que un
> agente bueno es un prompt largo, y es al revés: el detalle vive en la
> constitution, que ya está en contexto. El agente solo dice cuál es su rol y
> cuándo parar."

**Concepto que nombras.** _Single source of truth_ y _ownership boundaries_.

---

# ACTO 2 — Por qué garantías y no peticiones

Este es el corazón de la charla.

## 2.1 · El hook de git — pedir vs garantizar

**Qué muestras.** Primero el hook. Después, en vivo:

```bash
echo '{"tool_input":{"command":"git push origin main"}}' | .claude/hooks/git-guard.sh
```

Y luego se lo pides a Claude Code directamente. Se bloquea.

**La decisión.** Prohibir el push a main con un hook de `PreToolUse`.

**La alternativa descartada.** Ponerlo en CLAUDE.md: "nunca hagas push a main".

**Por qué.** Una instrucción en un prompt es una **petición**. El modelo la
cumple casi siempre, y ese _casi_ es todo el problema. Un hook es código que
corre siempre, no depende del criterio del modelo, y se puede probar en
aislamiento sin gastar un token.

Y el detalle que remata: **un `deny` de PreToolUse bloquea incluso con
`--dangerously-skip-permissions`.** Los hooks solo pueden restringir permisos,
nunca ampliarlos. Nadie en el equipo se salta un hook comiteado.

**Cómo decirlo.**

> "Yo podría haber escrito 'nunca hagas push a main' en el prompt. Y funciona…
> el noventa y ocho por ciento de las veces. El problema es el dos por ciento.
> Esto no es un prompt. Es un hook. No le estoy pidiendo al modelo que no lo
> haga: le estoy quitando la capacidad de hacerlo. Y miren esto —"
>
> _(corres el flag de bypass)_
>
> "— ni siquiera saltándose todos los permisos. Los hooks solo restringen.
> Nunca amplían."

**Momento de demo.** El más fuerte de la charla. Muéstralo en terminal primero
(rápido, determinista, no depende de la red) y después con el agente.

**Concepto que nombras.** _Determinism boundary._

**La pregunta.** _"¿No basta con la branch protection de GitHub?"_

> "Es complementaria, y la tengo también. Pero la branch protection actúa
> cuando el push ya salió: el agente ya gastó tokens, ya hizo el commit, ya
> falló. El hook lo detiene antes. Y al revés: el hook es local y se puede
> borrar, la branch protection no. Ninguna capa se confía de la otra. Eso se
> llama _defense in depth_."

---

## 2.2 · Más instrucciones no dan más consistencia

**Qué muestras.** Un agente corto al lado de un validador (`quality-gate.sh`).

**La decisión.** Todo lo verificable mecánicamente es código. Solo lo que
requiere criterio es prompt.

**La alternativa descartada.** Describir en prosa cómo debe verse el output
correcto, con más y más detalle cada vez que algo sale mal.

**Por qué.** Este es el punto contraintuitivo de la charla. Cuando el output
sale inconsistente, el instinto es agregar instrucciones. Pero cada instrucción
nueva es una cosa más que el modelo tiene que ponderar, y ponderar introduce
varianza. **Para que el output sea siempre igual, quitas prosa y agregas
validadores.**

**Cómo decirlo.**

> "Levanten la mano los que, cuando el modelo no hace lo que quieren, le
> agregan un párrafo más al prompt. Yo también. Y es exactamente lo que no hay
> que hacer. Cada párrafo es una cosa más que el modelo tiene que sopesar, y
> sopesar es donde entra la varianza. Si quieres output determinista, no lo
> describas: valídalo. Genera, valida, corrige, repite."

**Concepto que nombras.** _Validator loop_ y _degrees of freedom_.

---

## 2.3 · Los gates baratos antes del revisor caro

**Qué muestras.** El diagrama del flujo: implementer → test-writer → gates →
reviewer.

**La decisión.** El agente reviewer corre **después** de lint, typecheck, tests
y build.

**La alternativa descartada.** El reviewer como hook, o el reviewer primero.

**Por qué.** Dos razones. Economía: no gastas tokens revisando código que no
compila. Y separación de responsabilidades: el linter ya cubre estilo, así que
el reviewer tiene prohibido comentar sobre formato. Solo mira lo que un
humano miraría — si el diff hace lo que el spec pide y nada más.

**Cómo decirlo.**

> "El orden importa. Lo determinista primero, porque es barato y no falla nunca.
> El criterio después, porque es caro y sí falla. Y como el linter ya cubrió el
> estilo, al revisor le prohibí explícitamente comentar sobre formato. Solo
> revisa lo que un humano revisaría."

**Concepto que nombras.** _Deterministic gates vs judgment agents._

---

# ACTO 3 — Por qué los agentes están diseñados así

## 3.1 · El que escribe tests no puede ver el código

**Qué muestras.** `test-writer.md`, señalando la regla crítica. Luego rompes
una regla en el service y muestras que el test falla.

**La decisión.** El agente de tests lee el spec y las reglas de negocio. **No
lee la implementación.**

**La alternativa descartada.** Que lea el código y escriba tests para lo que
encuentre. Es lo natural y lo que hacen casi todas las herramientas.

**Por qué.** Si escribe tests leyendo la implementación, los tests confirman lo
que el código **hace**, no lo que el spec **pide**. Si el implementer entendió
mal la regla, el test valida el malentendido con toda tranquilidad. Tienes suite
verde y comportamiento equivocado. La separación es lo único que preserva la
capacidad de detectar el error.

**Cómo decirlo.**

> "Este es el detalle del que estoy más orgulloso, y es una sola línea del
> prompt. El agente que escribe los tests tiene prohibido leer la
> implementación. ¿Por qué? Porque si la lee, los tests van a confirmar lo que
> el código hace, no lo que yo pedí. Si el otro agente entendió mal la regla,
> este escribe un test que valida el malentendido, y yo me quedo con la suite
> en verde y el comportamiento equivocado. La independencia es lo único que me
> deja detectar que alguien entendió mal."

**Momento de demo.** Borra la validación de BR-01 del service. El test falla.

> "El test no sabe cómo está implementado. Solo sabe qué dice el spec."

**La pregunta.** _"¿No genera tests que no compilan?"_

> "A veces, y los gates lo atrapan. Prefiero un test que no compila a un test
> que pasa por la razón equivocada. El primero es ruido; el segundo es una
> mentira."

---

## 3.2 · Un flujo semi-autónomo necesita una ruta de fracaso

**Qué muestras.** Los límites en `config.json` y `.sdd/blocked.md`.

**La decisión.** Máximo 3 rechazos por task, máximo 10 archivos, máximo 5 tasks
por corrida. Al tope, se detiene y escribe qué pasó.

**La alternativa descartada.** Dejarlo iterar hasta que salga.

**Por qué.** Sin límite tienes un loop: el reviewer rechaza, el implementer
corrige, el reviewer rechaza otra vez. Con dinero de por medio y sin que nadie
mire. Un flujo semi-autónomo sin ruta de recuperación definida no es
semi-autónomo: es un flujo que te deja tirado, y encima cobrándote.

**Cómo decirlo.**

> "Autonomía sin límites no es autonomía, es un loop con tarjeta de crédito.
> Todo agente que se ejecuta solo necesita responder tres preguntas: cuándo
> paro, qué escribo cuando paro, y quién se entera."

**Concepto que nombras.** _Blast radius limiting_ y _escalation path._

---

## 3.3 · Dos puertas humanas que no se mueven

**Qué muestras.** `config.json`, la sección `gates`.

**La decisión.** La aprobación del spec y el merge son humanos en **todos** los
modos, incluido `auto`.

**La alternativa descartada.** Autonomía como booleano: o revisas todo o no
revisas nada.

**Por qué.** Los dos puntos donde el criterio humano es irremplazable están al
principio y al final. Al principio porque si el spec está mal, todo lo que sigue
amplifica el error con mucha eficiencia. Al final porque el merge es donde la
responsabilidad cambia de dueño.

**Cómo decirlo.**

> "Todo el mundo pregunta si el modo automático es seguro. La pregunta está mal
> planteada. No es un interruptor: es una escala, y hay dos puntos que no se
> mueven nunca. Apruebo el spec, y apruebo el merge. En el medio puede correr
> solo toda la noche."

---

# ACTO 4 — Lo que produce

## 4.1 · La regla que la IA implementa mal por defecto

**Qué muestras.** BR-01 (no solapamiento) y el constraint de Postgres.

**La decisión.** El invariante de no solapamiento vive en la base de datos.

**La alternativa descartada.** Validarlo en el service con un `findFirst` antes
de insertar. Es lo que genera un agente si no le dices otra cosa.

**Por qué.** Ese patrón tiene una condición de carrera: dos requests
simultáneas pasan la validación y ambas insertan. Con canchas de fútbol y
horarios pico, eso pasa. Y ningún unit test con Prisma mockeado lo detecta
jamás, porque el mock no tiene concurrencia.

**Cómo decirlo.**

> "Le pedí a un agente que impidiera reservas solapadas y me escribió un
> `findFirst` seguido de un `create`. Compila, pasa los tests, y tiene una
> condición de carrera del tamaño de una casa. Dos personas reservan la misma
> cancha al mismo tiempo y ambas ganan. Este constraint de Postgres lo hace
> imposible. Pero la IA no lo iba a escribir sola — está en la constitution
> porque yo lo puse ahí. La calidad del spec es el techo de la calidad del
> código."

**Momento de demo.** Si tienes tiempo, corre dos requests concurrentes contra
la versión sin constraint y muestra las dos reservas. Es demoledor.

**Concepto que nombras.** Por qué los tests de integración con Postgres real
no son opcionales para reglas de concurrencia.

---

## 4.2 · Trazabilidad: de la regla a la línea

**Qué muestras.** El PR abierto, con su tabla. Y en vivo:

```bash
grep -rn "BR-01" test/ src/
```

**La decisión.** IDs estables que viajan por todo el pipeline.

```
BR-01 → spec.md → task T-012 → test 'BR-01: ...' → commit → PR
```

**La alternativa descartada.** Cobertura de código como métrica de calidad.

**Por qué.** Cobertura te dice cuántas líneas ejecutaron los tests. No te dice
si la regla de cancelación está implementada. Con IDs, la pregunta "¿está
implementada?" se responde con un grep en vez de leyendo código.

**Cómo decirlo.**

> "¿Está implementada la regla de cancelación? Con cobertura, eso se responde
> leyendo código. Con IDs, se responde así —" _(corres el grep)_ "— y la
> respuesta llega en un segundo. Cobertura no es la métrica. Trazabilidad sí."

---

## 4.3 · El costo, sin adornos

**Qué muestras.** La sección de costo del PR y `.sdd/runs/`.

**La decisión.** Instrumentar tokens, costo y duración por feature.

**Por qué.** Porque alguien en la sala está haciendo la cuenta mentalmente y
tienes que ganarle de mano. Y porque sin medir no sabes si el flujo vale lo que
cuesta.

**Cómo decirlo.**

> "SDD consume más tokens por feature que el vibe coding. Es cierto y no lo voy
> a esconder. La pregunta correcta no es cuánto cuesta la feature: es cuánto
> cuesta la feature más los ciclos de retrabajo que te ahorraste. Por eso mido."

---

# Cierre

Vuelve a la tesis, ahora con las piezas puestas:

> "Nada de lo que les mostré hace que el modelo escriba mejor código. El modelo
> ya escribe bien. Lo que cambié es dónde se toman las decisiones y quién las
> garantiza. El spec define qué. La constitution define cómo. Los hooks
> garantizan lo verificable. Los agentes deciden lo que requiere criterio. Y yo
> me quedo con las dos decisiones que no puedo delegar: si el spec está bien, y
> si esto entra a producción.
>
> La IA no reemplazó al desarrollador. Movió el trabajo hacia arriba."

---

# Notas de producción

## Si tienes 20 minutos

Corta a cuatro momentos: **1.2** (clarify pregunta), **2.1** (el hook),
**3.1** (test-writer ciego), **4.2** (trazabilidad). Con eso la tesis se
sostiene sola.

## Si tienes 45

Todo, pero solo tres demos en vivo: el hook, clarify, y el flujo completo.
El resto en pantalla estática.

## A prueba de fallas

- **Pregraba el flujo completo** de `/sdd-implement`. Es lo más largo y lo que
  más depende de la red. Ten el video listo.
- **La demo del hook córrela en terminal**, no a través del agente. Es
  instantánea, determinista y no depende de nada externo.
- **Ten el PR ya creado** en una pestaña. Si `gh pr create` falla en vivo,
  cambias de pestaña y sigues.
- **Ensaya el grep de BR-01.** Es la demo más barata y de las más efectivas.

## Preguntas que van a salir sí o sí

**"¿Cuánto te tomó construir esto?"** — Da el número real. Y agrega que los
hooks son ~40 líneas de bash y son la mitad del valor.

**"¿Esto escala a un equipo?"** — Sí, y mejor que a una persona: la constitution
es donde el equipo escribe sus acuerdos una vez. Lo que hoy vive en la cabeza
del senior pasa a un archivo que el agente consulta.

**"¿Qué pasa cuando el spec está mal?"** — Sale código equivocado, rápido y con
tests verdes. Por eso la aprobación del spec no se automatiza nunca. Es honesto
decirlo, y te da credibilidad.

**"¿Funciona con Copilot / Cursor / Gemini?"** — Spec Kit sí, es agnóstico. Los
hooks y subagentes son específicos de Claude Code; el concepto se traduce, la
implementación no.
