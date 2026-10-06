import urllib.request
import json
import os
import sys
from pathlib import Path

# Add backend dir to path for direct model testing if needed
backend_dir = Path(__file__).resolve().parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

def run_tests():
    print("==================================================")
    print("     TESTING REIMBURSEMENT POLICY WORKFLOW        ")
    print("==================================================")

    from main import app, evaluate_claim_policy, claims_db, category_policies_db, save_policies, save_claims
    from models import CategoryPolicy, BillItem, ClaimCreate, ClaimUpdate, Claim

    # Test 1: Category Policy Evaluation Engine Unit Checks
    print("\n--- Test 1: Policy Engine Evaluation ---")
    test_policies = [
        CategoryPolicy(category="Team Lunch", per_bill="1,000", block=True),
        CategoryPolicy(category="Office Grocery", per_bill="0", block=True)
    ]

    # Bill under limit (800 < 1000)
    bill_under = [BillItem(name="lunch1.jpg", category="Team Lunch", total=800.0, read="ai")]
    res_under = evaluate_claim_policy(bill_under, "Team Lunch", test_policies)
    print("Under Limit (Rs.800 vs Rs.1,000 cap):", res_under)
    assert res_under["is_compliant"] == True
    assert res_under["max_allowable"] == 800.0

    # Bill over limit (1500 > 1000)
    bill_over = [BillItem(name="lunch2.jpg", category="Team Lunch", total=1500.0, read="ai")]
    res_over = evaluate_claim_policy(bill_over, "Team Lunch", test_policies)
    print("Over Limit (Rs.1,500 vs Rs.1,000 cap):", res_over)
    assert res_over["is_compliant"] == False
    assert res_over["is_blocked"] == True
    assert res_over["max_allowable"] == 1000.0
    assert len(res_over["violations"]) > 0

    # Bill on 0 limit category
    bill_zero = [BillItem(name="grocery.jpg", category="Office Grocery", total=200.0, read="ai")]
    res_zero = evaluate_claim_policy(bill_zero, "Office Grocery", test_policies)
    print("Zero Limit Category:", res_zero)
    assert res_zero["is_compliant"] == False
    assert res_zero["max_allowable"] == 0.0

    print("SUCCESS: Policy Engine Evaluation Passed!")

    # Test 2: Auto-Approval Workflow Verification
    print("\n--- Test 2: Auto-Approval vs Manual Routing ---")
    
    # Create compliant claim -> Auto approve
    from main import create_claim, update_claim_status
    
    claim_under_in = ClaimCreate(
        employee="Test Employee",
        dept="Engineering",
        title="Team Lunch Under Limit",
        category="Team Lunch",
        bills=bill_under,
        status="submitted"
    )
    # Temporarily update category_policies_db
    for i, cp in enumerate(category_policies_db):
        if cp.category == "Team Lunch":
            category_policies_db[i].per_bill = "1000"
            category_policies_db[i].per_day = ""
            category_policies_db[i].per_month = ""

    created_under = create_claim(claim_under_in)
    print(f"Compliant Claim Status: {created_under.status}, Approved: Rs.{created_under.approved}")
    assert created_under.status == "approved"
    assert created_under.approved == 800.0
    print("SUCCESS: Auto-Approval Passed!")

    # Create non-compliant claim -> Route to manual
    claim_over_in = ClaimCreate(
        employee="Test Employee",
        dept="Engineering",
        title="Team Lunch Over Limit",
        category="Team Lunch",
        bills=bill_over,
        status="submitted"
    )
    created_over = create_claim(claim_over_in)
    print(f"Non-Compliant Claim Status: {created_over.status}, Approved: Rs.{created_over.approved}, Violations: {created_over.policy_violations}")
    assert created_over.status == "submitted"
    assert created_over.approved == 0.0
    assert created_over.max_allowable == 1000.0
    print("SUCCESS: Manual Routing Passed!")

    # Test 3: 3 Approval Options
    print("\n--- Test 3: Manual Approval 3 Options ---")
    
    # Option 1: Approve Limit Only
    updated_opt1 = update_claim_status(
        created_over.id,
        ClaimUpdate(action="approve_limit", actor_name="Preeti Jawai")
    )
    print(f"Option 1 (Limit Only) -> Status: {updated_opt1.status}, Approved: Rs.{updated_opt1.approved}")
    assert updated_opt1.status == "approved"
    assert updated_opt1.approved == 1000.0
    print("SUCCESS: Option 1 (Approve Limit Only) Passed!")

    # Option 2: Approve Full Amount
    created_over2 = create_claim(claim_over_in)
    updated_opt2 = update_claim_status(
        created_over2.id,
        ClaimUpdate(action="approve_full", actor_name="Preeti Jawai")
    )
    print(f"Option 2 (Full Amount) -> Status: {updated_opt2.status}, Approved: Rs.{updated_opt2.approved}")
    assert updated_opt2.status == "approved"
    assert updated_opt2.approved == 1500.0
    print("SUCCESS: Option 2 (Approve Full Amount) Passed!")

    # Option 3: Reject Claim
    created_over3 = create_claim(claim_over_in)
    updated_opt3 = update_claim_status(
        created_over3.id,
        ClaimUpdate(action="reject", actor_name="Preeti Jawai", comment="Over limit without pre-approval")
    )
    print(f"Option 3 (Reject) -> Status: {updated_opt3.status}, Approved: Rs.{updated_opt3.approved}")
    assert updated_opt3.status == "rejected"
    assert updated_opt3.approved == 0.0
    print("SUCCESS: Option 3 (Reject Claim) Passed!")

    print("\n==================================================")
    print("  ALL POLICY ENFORCEMENT & WORKFLOW TESTS PASSED! ")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
