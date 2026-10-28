package store

import "testing"

// Fingerprint must not depend on item order or id case (it represents a
// normalized request, not a JSON serialization), and must change when
// anything meaningful changes.
func TestFingerprintIsDeterministic(t *testing.T) {
	const (
		warehouse = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"
		otherWH   = "11111111-1111-4111-8111-111111111111"
		prodOne   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
		prodTwo   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	)
	base := []ReservationItem{{ProductID: prodOne, Quantity: 2}, {ProductID: prodTwo, Quantity: 7}}
	reordered := []ReservationItem{{ProductID: prodTwo, Quantity: 7}, {ProductID: prodOne, Quantity: 2}}

	if Fingerprint(warehouse, base) != Fingerprint(warehouse, reordered) {
		t.Fatal("item order must not change the fingerprint")
	}
	if Fingerprint(warehouse, base) != Fingerprint("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", base) {
		t.Fatal("id case must not change the fingerprint")
	}
	if Fingerprint(warehouse, base) != Fingerprint(warehouse, base) {
		t.Fatal("fingerprint must be stable")
	}

	changedQty := []ReservationItem{{ProductID: prodOne, Quantity: 3}, {ProductID: prodTwo, Quantity: 7}}
	if Fingerprint(warehouse, base) == Fingerprint(warehouse, changedQty) {
		t.Fatal("different quantity must change the fingerprint")
	}
	if Fingerprint(warehouse, base) == Fingerprint(otherWH, base) {
		t.Fatal("different warehouse must change the fingerprint")
	}
	changedProduct := []ReservationItem{{ProductID: prodOne, Quantity: 2}, {ProductID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", Quantity: 7}}
	if Fingerprint(warehouse, base) == Fingerprint(warehouse, changedProduct) {
		t.Fatal("different product must change the fingerprint")
	}
}
