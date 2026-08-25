#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]

extern crate alloc;

use alloc::vec::Vec;
use alloy_primitives::{Address, B256, U64};
use alloy_sol_types::sol;
use stylus_sdk::prelude::*;

sol! {
    error InvalidOwner();
    error InvalidSender();
    error InvalidReceiver();
    error InvalidMaxHandoffs();
    error InvalidExpiry();
    error UnauthorizedSender();
    error DuplicateTask();
    error HandoffLimitReached();
    error MandateExpired();

    event TaskHandoffRecorded(
        bytes32 indexed taskId,
        address indexed sender,
        address indexed receiver,
        uint64 sequence,
        uint64 timestamp
    );
}

#[derive(SolidityError)]
pub enum AgentTaskRegistryError {
    InvalidOwner(InvalidOwner),
    InvalidSender(InvalidSender),
    InvalidReceiver(InvalidReceiver),
    InvalidMaxHandoffs(InvalidMaxHandoffs),
    InvalidExpiry(InvalidExpiry),
    UnauthorizedSender(UnauthorizedSender),
    DuplicateTask(DuplicateTask),
    HandoffLimitReached(HandoffLimitReached),
    MandateExpired(MandateExpired),
}

sol_storage! {
    #[entrypoint]
    pub struct AgentTaskRegistry {
        address owner;
        address permitted_sender;
        address permitted_receiver;
        uint64 max_handoffs;
        uint64 expiry;
        uint64 handoff_count;
        mapping(bytes32 => bool) seen_task_ids;
    }
}

#[public]
impl AgentTaskRegistry {
    #[constructor]
    pub fn constructor(
        &mut self,
        owner: Address,
        permitted_sender: Address,
        permitted_receiver: Address,
        max_handoffs: u64,
        expiry: u64,
    ) -> Result<(), Vec<u8>> {
        if owner == Address::ZERO {
            return Err(AgentTaskRegistryError::InvalidOwner(InvalidOwner {}).into());
        }
        if permitted_sender == Address::ZERO {
            return Err(AgentTaskRegistryError::InvalidSender(InvalidSender {}).into());
        }
        if permitted_receiver == Address::ZERO {
            return Err(AgentTaskRegistryError::InvalidReceiver(InvalidReceiver {}).into());
        }
        if max_handoffs == 0 {
            return Err(AgentTaskRegistryError::InvalidMaxHandoffs(InvalidMaxHandoffs {}).into());
        }
        if expiry <= self.vm().block_timestamp() {
            return Err(AgentTaskRegistryError::InvalidExpiry(InvalidExpiry {}).into());
        }

        self.owner.set(owner);
        self.permitted_sender.set(permitted_sender);
        self.permitted_receiver.set(permitted_receiver);
        self.max_handoffs.set(U64::from(max_handoffs));
        self.expiry.set(U64::from(expiry));
        Ok(())
    }

    pub fn record_handoff(&mut self, task_id: B256) -> Result<u64, AgentTaskRegistryError> {
        let sender = self.vm().msg_sender();
        let timestamp = self.vm().block_timestamp();

        if sender != self.permitted_sender.get() {
            return Err(AgentTaskRegistryError::UnauthorizedSender(
                UnauthorizedSender {},
            ));
        }
        if timestamp >= self.expiry.get().to::<u64>() {
            return Err(AgentTaskRegistryError::MandateExpired(MandateExpired {}));
        }
        if self.seen_task_ids.get(task_id) {
            return Err(AgentTaskRegistryError::DuplicateTask(DuplicateTask {}));
        }

        let count = self.handoff_count.get().to::<u64>();
        if count >= self.max_handoffs.get().to::<u64>() {
            return Err(AgentTaskRegistryError::HandoffLimitReached(
                HandoffLimitReached {},
            ));
        }

        let sequence = count + 1;
        self.seen_task_ids.setter(task_id).set(true);
        self.handoff_count.set(U64::from(sequence));
        self.vm().log(TaskHandoffRecorded {
            taskId: task_id,
            sender,
            receiver: self.permitted_receiver.get(),
            sequence,
            timestamp,
        });

        Ok(sequence)
    }

    pub fn owner(&self) -> Address {
        self.owner.get()
    }

    pub fn permitted_sender(&self) -> Address {
        self.permitted_sender.get()
    }

    pub fn permitted_receiver(&self) -> Address {
        self.permitted_receiver.get()
    }

    pub fn max_handoffs(&self) -> u64 {
        self.max_handoffs.get().to::<u64>()
    }

    pub fn expiry(&self) -> u64 {
        self.expiry.get().to::<u64>()
    }

    pub fn handoff_count(&self) -> u64 {
        self.handoff_count.get().to::<u64>()
    }

    pub fn has_task(&self, task_id: B256) -> bool {
        self.seen_task_ids.get(task_id)
    }
}

#[cfg(test)]
mod tests;
