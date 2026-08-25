# Plan de demo

## Prerrequisito

Los 18 pasos de la guía hechos, **más** un `docker-compose.test.yml` con
Postgres. Sin eso, los tests de integración de BR-01 y BR-05 no corren, y son
justamente los que demuestran el punto de concurrencia.

### Reparto de features

| Cuándo      | Feature                          | Reglas                | Por qué ahí                                                                                |
| ----------- | -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| **Hoy**     | Core de reservas                 | BR-01, 02, 03, 06, 07 | Necesitas dominio existente para que lo demás tenga sobre qué construir                    |
| **Video**   | Cancelación + límite por usuario | BR-04, BR-05          | Grande: incluye migración e integración. Puedes mostrar un rechazo del reviewer sin riesgo |
| **En vivo** | Consulta de disponibilidad       | BR-08 (nueva)         | Pequeña, sin migración, solo lectura, con ambigüedad natural                               |

**La clave del reparto:** el momento de `clarify` va **en vivo, no en el
video**. Es la mejor demo de la charla y pierde todo su efecto grabada. Por eso
BR-04 (la ambigüedad que plantaste al inicio) se resuelve en el video, y plantas
una nueva en la feature en vivo.

---

### Prompt 1 — Hoy · Core de reservas

```
/sdd-new Módulo de reservas de canchas. Un usuario puede crear una reserva
para una cancha en un rango de tiempo, listar sus reservas activas, y
cancelar una reserva existente. Aplican las reglas BR-01, BR-02, BR-03,
BR-06 y BR-07 de docs/business-rules.md. BR-04 y BR-05 quedan fuera de
alcance en esta iteración.
```

Después:

```
/sdd-implement
/sdd-status
/sdd-ship
```

**Verificación antes de seguir.** Confirma que BR-01 quedó como constraint de
Postgres y no como un `findFirst` en el service:

```bash
grep -rn "EXCLUDE USING gist" prisma/migrations/
```

Si el agente lo puso en el service, tu constitution no fue lo bastante
explícita. Arréglala **ahí**, no en el código, y vuelve a correr. Ese ajuste es
en sí mismo aprendizaje sobre cómo funciona el flujo — y es material honesto
para la charla.

---

### Prompt 2 — Video · Cancelación y límites

```
/sdd-new Política de cancelación y límite de reservas. Al cancelar una
reserva se calcula una penalización según BR-04. Un usuario no puede tener
más de 3 reservas activas simultáneas según BR-05. La penalización se
persiste en la reserva cancelada.
```

Esta es la buena para grabar porque toca todo el sistema: migración de Prisma
(dispara `prisma-guard`), test de integración real para BR-05, y suficiente
lógica de negocio para que el reviewer tenga algo que decir.

**Cómo grabarlo para que sea robusto.** Dos sesiones, y editas:

1. **Pasada limpia.** El flujo completo de `/sdd-new` a `/sdd-ship`, sin
   interrupciones.
2. **Pasada de fallos provocados.** Rompes el build antes de que corran los
   gates (`const x: number = "a"`), y metes lógica de negocio en el controller
   para que el reviewer rechace. Recortas esos clips y los insertas.

Nadie se va a sentir estafado porque el video esté grabado — un flujo completo
toma demasiado tiempo para hacerlo en vivo y todos lo saben. Lo que **sí**
notan es si no muestras ningún fallo, porque asumen que lo escondiste.

---

### Prompt 3 — En vivo · Consulta de disponibilidad

Antes de la charla, agrega a `docs/business-rules.md`:

```markdown
| BR-08 | Consultar disponibilidad de una cancha para una fecha dada | Service + test |

## Open questions

- BR-08: ¿en bloques de qué duración se devuelve la disponibilidad?
- BR-08: ¿una cancha en mantenimiento aparece como no disponible, o no aparece?
- BR-08: ¿las reservas canceladas liberan el slot inmediatamente?
```

En vivo:

```
/sdd-new Consulta de disponibilidad. Dado un id de cancha y una fecha,
devolver los horarios disponibles de ese día según BR-08.
```

Tres ambigüedades **reales**, no artificiales — cualquiera que haya construido
un sistema de reservas las reconoce al instante. `clarify` las levanta, tú las
respondes en vivo, y el público entiende el punto completo en noventa segundos.

Es solo lectura, sin migración, y se apoya en BR-01 y BR-03 que ya existen.
Riesgo bajo, valor alto.

**Plan B.** Ten el resultado de esta feature ya corrido en otra rama
(`demo/br-08-backup`). Si algo falla en vivo, cambias de rama y muestras el
resultado. Nunca dependas de que la red coopere frente a un auditorio.

---

## Checklist previo a la charla

- [ ] Los 18 pasos de la guía implementados y verificados
- [ ] `docker-compose.test.yml` con Postgres funcionando
- [ ] Feature 1 (core) mergeada a main
- [ ] Feature 2 (cancelación) grabada y editada
- [ ] BR-08 agregada a `business-rules.md` con sus preguntas abiertas
- [ ] Rama `demo/br-08-backup` con la feature 3 ya resuelta
- [ ] Demo del hook ensayada en terminal (`echo ... | git-guard.sh`)
- [ ] Grep de trazabilidad ensayado (`grep -rn "BR-01" test/ src/`)
- [ ] PR de ejemplo abierto en una pestaña, por si `gh` falla
- [ ] `docs/sdd/` en el repo con guía, glosario y decisiones de diseño
- [ ] Link desde el README raíz: "¿Vienes de la charla? Empieza en `docs/sdd/`"
