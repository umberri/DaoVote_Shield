pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DaoVoteShield is ZamaEthereumConfig {
    struct Proposal {
        string title;
        string description;
        address creator;
        uint256 endTime;
        euint32 encryptedYesVotes;
        euint32 encryptedNoVotes;
        uint32 decryptedYesVotes;
        uint32 decryptedNoVotes;
        bool isTallied;
    }

    struct Voter {
        mapping(string => bool) hasVoted;
    }

    mapping(string => Proposal) public proposals;
    mapping(address => Voter) public voters;
    string[] public proposalIds;

    event ProposalCreated(string indexed proposalId, address indexed creator);
    event VoteCast(string indexed proposalId, address indexed voter);
    event VotesTallied(string indexed proposalId, uint32 yesVotes, uint32 noVotes);

    constructor() ZamaEthereumConfig() {}

    function createProposal(
        string calldata proposalId,
        string calldata title,
        string calldata description,
        uint256 duration
    ) external {
        require(bytes(proposals[proposalId].title).length == 0, "Proposal already exists");
        require(duration > 0, "Duration must be positive");

        proposals[proposalId] = Proposal({
            title: title,
            description: description,
            creator: msg.sender,
            endTime: block.timestamp + duration,
            encryptedYesVotes: FHE.fromUint(0),
            encryptedNoVotes: FHE.fromUint(0),
            decryptedYesVotes: 0,
            decryptedNoVotes: 0,
            isTallied: false
        });
        proposalIds.push(proposalId);
        emit ProposalCreated(proposalId, msg.sender);
    }

    function castVote(
        string calldata proposalId,
        bool voteChoice,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        require(block.timestamp <= proposals[proposalId].endTime, "Voting period has ended");
        require(!voters[msg.sender].hasVoted[proposalId], "Already voted");

        euint32 encryptedVoteValue = FHE.fromExternal(encryptedVote, inputProof);
        require(FHE.isInitialized(encryptedVoteValue), "Invalid encrypted vote");

        if (voteChoice) {
            proposals[proposalId].encryptedYesVotes = FHE.add(
                proposals[proposalId].encryptedYesVotes,
                encryptedVoteValue
            );
        } else {
            proposals[proposalId].encryptedNoVotes = FHE.add(
                proposals[proposalId].encryptedNoVotes,
                encryptedVoteValue
            );
        }

        voters[msg.sender].hasVoted[proposalId] = true;
        emit VoteCast(proposalId, msg.sender);
    }

    function tallyVotes(
        string calldata proposalId,
        bytes memory yesVoteProof,
        bytes memory noVoteProof
    ) external {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        require(block.timestamp > proposals[proposalId].endTime, "Voting period not ended");
        require(!proposals[proposalId].isTallied, "Votes already tallied");

        bytes memory yesVoteValue = FHE.decrypt(proposals[proposalId].encryptedYesVotes, yesVoteProof);
        bytes memory noVoteValue = FHE.decrypt(proposals[proposalId].encryptedNoVotes, noVoteProof);

        proposals[proposalId].decryptedYesVotes = abi.decode(yesVoteValue, (uint32));
        proposals[proposalId].decryptedNoVotes = abi.decode(noVoteValue, (uint32));
        proposals[proposalId].isTallied = true;

        emit VotesTallied(proposalId, proposals[proposalId].decryptedYesVotes, proposals[proposalId].decryptedNoVotes);
    }

    function getProposal(string calldata proposalId)
        external
        view
        returns (
            string memory title,
            string memory description,
            address creator,
            uint256 endTime,
            uint32 decryptedYesVotes,
            uint32 decryptedNoVotes,
            bool isTallied
        )
    {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        Proposal storage p = proposals[proposalId];
        return (
            p.title,
            p.description,
            p.creator,
            p.endTime,
            p.decryptedYesVotes,
            p.decryptedNoVotes,
            p.isTallied
        );
    }

    function getEncryptedVotes(string calldata proposalId)
        external
        view
        returns (euint32 encryptedYesVotes, euint32 encryptedNoVotes)
    {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        return (
            proposals[proposalId].encryptedYesVotes,
            proposals[proposalId].encryptedNoVotes
        );
    }

    function getAllProposalIds() external view returns (string[] memory) {
        return proposalIds;
    }

    function hasVoted(address voter, string calldata proposalId) external view returns (bool) {
        return voters[voter].hasVoted[proposalId];
    }
}


