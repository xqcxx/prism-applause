;; Social proof endorsements with fixed categories and cooldown.

(define-constant MIN-CATEGORY u1)
(define-constant MAX-CATEGORY u5)
(define-constant COOLDOWN-BLOCKS u5)

(define-constant ERR-BAD-CATEGORY (err u100))
(define-constant ERR-SELF-KUDOS (err u101))
(define-constant ERR-ALREADY-EXISTS (err u102))
(define-constant ERR-NOT-FOUND (err u103))
(define-constant ERR-COOLDOWN (err u104))

(define-map kudos
	{
		from: principal,
		to: principal,
		category: uint,
	}
	bool
)

(define-map received-count
	{
		to: principal,
		category: uint,
	}
	uint
)

(define-map total-received principal uint)

(define-map last-action-height
	{
		from: principal,
		to: principal,
	}
	uint
)

(define-public (give-kudos (to principal) (category uint))
	(begin
		(asserts! (is-valid-category category) ERR-BAD-CATEGORY)
		(asserts! (not (is-eq tx-sender to)) ERR-SELF-KUDOS)
		(asserts! (is-none (map-get? kudos { from: tx-sender, to: to, category: category })) ERR-ALREADY-EXISTS)
		(asserts! (cooldown-passed tx-sender to) ERR-COOLDOWN)
		(map-set kudos { from: tx-sender, to: to, category: category } true)
		(map-set received-count
			{ to: to, category: category }
			(+ u1 (default-to u0 (map-get? received-count { to: to, category: category })))
		)
		(map-set total-received to (+ u1 (default-to u0 (map-get? total-received to))))
		(set-last-action tx-sender to)
		(print {
			event: "kudos-given",
			from: tx-sender,
			to: to,
			category: category,
		})
		(ok true)
	)
)

(define-public (revoke-kudos (to principal) (category uint))
	(let (
			(category-total (default-to u0 (map-get? received-count { to: to, category: category })))
			(total (default-to u0 (map-get? total-received to)))
		)
		(asserts! (is-valid-category category) ERR-BAD-CATEGORY)
		(asserts! (is-some (map-get? kudos { from: tx-sender, to: to, category: category })) ERR-NOT-FOUND)
		(asserts! (cooldown-passed tx-sender to) ERR-COOLDOWN)
		(asserts! (> category-total u0) ERR-NOT-FOUND)
		(asserts! (> total u0) ERR-NOT-FOUND)
		(map-delete kudos { from: tx-sender, to: to, category: category })
		(map-set received-count { to: to, category: category } (- category-total u1))
		(map-set total-received to (- total u1))
		(set-last-action tx-sender to)
		(print {
			event: "kudos-revoked",
			from: tx-sender,
			to: to,
			category: category,
		})
		(ok true)
	)
)

(define-read-only (has-kudos (from principal) (to principal) (category uint))
	(ok (is-some (map-get? kudos { from: from, to: to, category: category })))
)

(define-read-only (get-category-count (to principal) (category uint))
	(ok (default-to u0 (map-get? received-count { to: to, category: category })))
)

(define-read-only (get-total-kudos (to principal))
	(ok (default-to u0 (map-get? total-received to)))
)

(define-read-only (get-last-action-height (from principal) (to principal))
	(ok (default-to u0 (map-get? last-action-height { from: from, to: to })))
)

(define-private (is-valid-category (category uint))
	(and (>= category MIN-CATEGORY) (<= category MAX-CATEGORY))
)

(define-private (cooldown-passed (from principal) (to principal))
	(let ((last (default-to u0 (map-get? last-action-height { from: from, to: to }))))
		(or (is-eq last u0) (>= burn-block-height (+ last COOLDOWN-BLOCKS)))
	)
)

(define-private (set-last-action (from principal) (to principal))
	(map-set last-action-height { from: from, to: to } burn-block-height)
)

