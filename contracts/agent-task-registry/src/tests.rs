use alloy_primitives::{Address, B256};
use alloy_sol_types::SolEvent;
use stylus_sdk::testing::{TestVM, TestVMBuilder};

use super::*;

const NOW: u64 = 1_000;
const EXPIRY: u64 = 2_000;

fn owner() -> Address {
    Address::from([0x11; 20])
}

fn sender() -> Address {
    Address::from([0x22; 20])
}

fn receiver() -> Address {
    Address::from([0x33; 20])
}

fn task(number: u8) -> B256 {
    B256::from([number; 32])
}

fn successful_handoff(result: Result<u64, AgentTaskRegistryError>) -> u64 {
    match result {
        Ok(sequence) => sequence,
        Err(_) => panic!("expected the handoff to succeed"),
    }
}

fn configured_registry(max_handoffs: u64) -> (TestVM, AgentTaskRegistry) {
    let vm = TestVMBuilder::new().sender(sender()).build();
    vm.set_block_timestamp(NOW);
    let mut registry = AgentTaskRegistry::from(&vm);
    registry
        .constructor(owner(), sender(), receiver(), max_handoffs, EXPIRY)
        .expect("valid configuration should initialize");
    (vm, registry)
}

#[test]
fn constructor_stores_the_approved_configuration() {
    let (_, registry) = configured_registry(3);

    assert_eq!(registry.owner(), owner());
    assert_eq!(registry.permitted_sender(), sender());
    assert_eq!(registry.permitted_receiver(), receiver());
    assert_eq!(registry.max_handoffs(), 3);
    assert_eq!(registry.expiry(), EXPIRY);
    assert_eq!(registry.handoff_count(), 0);
}

#[test]
fn constructor_rejects_zero_addresses() {
    for (owner, permitted_sender, permitted_receiver) in [
        (Address::ZERO, sender(), receiver()),
        (owner(), Address::ZERO, receiver()),
        (owner(), sender(), Address::ZERO),
    ] {
        let vm = TestVM::new();
        vm.set_block_timestamp(NOW);
        let mut registry = AgentTaskRegistry::from(&vm);

        assert!(registry
            .constructor(owner, permitted_sender, permitted_receiver, 1, EXPIRY)
            .is_err());
    }
}

#[test]
fn constructor_rejects_zero_limit_and_non_future_expiry() {
    let vm = TestVM::new();
    vm.set_block_timestamp(NOW);
    let mut registry = AgentTaskRegistry::from(&vm);

    assert!(registry
        .constructor(owner(), sender(), receiver(), 0, EXPIRY)
        .is_err());
    assert!(registry
        .constructor(owner(), sender(), receiver(), 1, NOW)
        .is_err());
}

#[test]
fn authorized_handoff_updates_state_and_emits_evidence() {
    let (vm, mut registry) = configured_registry(2);
    let task_id = task(1);

    assert_eq!(successful_handoff(registry.record_handoff(task_id)), 1);
    assert_eq!(registry.handoff_count(), 1);
    assert!(registry.has_task(task_id));

    let logs = vm.get_emitted_logs();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].0[0], TaskHandoffRecorded::SIGNATURE_HASH);
}

#[test]
fn unauthorized_sender_cannot_record_a_handoff() {
    let (vm, mut registry) = configured_registry(2);
    vm.set_sender(Address::from([0x44; 20]));

    assert!(matches!(
        registry.record_handoff(task(1)),
        Err(AgentTaskRegistryError::UnauthorizedSender(_))
    ));
    assert_eq!(registry.handoff_count(), 0);
    assert!(!registry.has_task(task(1)));
}

#[test]
fn duplicate_task_identifier_is_rejected_without_advancing_count() {
    let (_, mut registry) = configured_registry(2);

    assert_eq!(successful_handoff(registry.record_handoff(task(1))), 1);
    assert!(matches!(
        registry.record_handoff(task(1)),
        Err(AgentTaskRegistryError::DuplicateTask(_))
    ));
    assert_eq!(registry.handoff_count(), 1);
}

#[test]
fn maximum_handoff_limit_is_enforced() {
    let (_, mut registry) = configured_registry(1);

    assert_eq!(successful_handoff(registry.record_handoff(task(1))), 1);
    assert!(matches!(
        registry.record_handoff(task(2)),
        Err(AgentTaskRegistryError::HandoffLimitReached(_))
    ));
    assert_eq!(registry.handoff_count(), 1);
    assert!(!registry.has_task(task(2)));
}

#[test]
fn mandate_is_expired_at_its_expiry_timestamp() {
    let (vm, mut registry) = configured_registry(2);
    vm.set_block_timestamp(EXPIRY);

    assert!(matches!(
        registry.record_handoff(task(1)),
        Err(AgentTaskRegistryError::MandateExpired(_))
    ));
    assert_eq!(registry.handoff_count(), 0);
}
